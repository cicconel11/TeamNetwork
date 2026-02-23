import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_BILLING_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, logEnterpriseAuditActionAwaited, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { getBillableOrgCount, getSubOrgPricing } from "@/lib/enterprise/pricing";
import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";
import { requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

const adjustQuantitySchema = z
  .object({
    adjustType: z.enum(["sub_org", "alumni_bucket"]),
    newQuantity: z.number().int().min(1).max(1000),
    expectedCurrentQuantity: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

// Type for enterprise subscription row (until types are regenerated)
interface EnterpriseSubscriptionRow {
  id: string;
  enterprise_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: "month" | "year";
  alumni_bucket_quantity: number;
  sub_org_quantity: number | null;
  status: string;
  current_period_end: string | null;
}

// Type for enterprise-managed org count from view
interface EnterpriseManagedCountRow {
  enterprise_managed_org_count: number;
}

/**
 * Retry a DB write once after a short delay.
 * Returns the error from the final attempt, or null on success.
 */
async function retryDbWrite(
  writeFn: () => Promise<{ error: Error | null }>
): Promise<{ error: Error | null }> {
  const first = await writeFn();
  if (!first.error) return first;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return writeFn();
}

/**
 * Reconcile DB subscription state with Stripe metadata.
 * If Stripe metadata (sub_org_quantity, alumni_bucket_quantity) differs from DB,
 * update DB to match Stripe — healing any prior Stripe-succeeds-DB-fails scenario.
 *
 * Returns the (possibly updated) subscription row.
 */
async function reconcileSubscriptionFromStripe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceSupabase: any,
  subscription: EnterpriseSubscriptionRow,
  enterpriseId: string,
  auditContext: {
    userId: string;
    userEmail: string;
    req: Request;
  }
): Promise<EnterpriseSubscriptionRow> {
  if (!subscription.stripe_subscription_id) return subscription;

  let stripeSub;
  try {
    stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
  } catch (err) {
    // If we can't reach Stripe, skip reconciliation and proceed with DB values
    console.warn("[billing/adjust] Reconciliation skipped — Stripe fetch failed:", err);
    return subscription;
  }

  const stripeSubOrgQty = stripeSub.metadata?.sub_org_quantity
    ? parseInt(stripeSub.metadata.sub_org_quantity, 10)
    : null;
  const stripeAlumniBucketQty = stripeSub.metadata?.alumni_bucket_quantity
    ? parseInt(stripeSub.metadata.alumni_bucket_quantity, 10)
    : null;

  const updates: Record<string, unknown> = {};
  const driftFields: string[] = [];

  if (
    stripeSubOrgQty !== null &&
    !isNaN(stripeSubOrgQty) &&
    stripeSubOrgQty !== subscription.sub_org_quantity
  ) {
    updates.sub_org_quantity = stripeSubOrgQty;
    driftFields.push("sub_org_quantity");
  }
  if (
    stripeAlumniBucketQty !== null &&
    !isNaN(stripeAlumniBucketQty) &&
    stripeAlumniBucketQty !== subscription.alumni_bucket_quantity
  ) {
    updates.alumni_bucket_quantity = stripeAlumniBucketQty;
    driftFields.push("alumni_bucket_quantity");
  }

  if (driftFields.length === 0) return subscription;

  // DB drifted from Stripe — heal it
  updates.updated_at = new Date().toISOString();

  console.warn("[billing/adjust] Reconciling DB drift from Stripe:", {
    enterpriseId,
    driftFields,
    db: {
      sub_org_quantity: subscription.sub_org_quantity,
      alumni_bucket_quantity: subscription.alumni_bucket_quantity,
    },
    stripe: {
      sub_org_quantity: stripeSubOrgQty,
      alumni_bucket_quantity: stripeAlumniBucketQty,
    },
  });

  const { error: reconcileError } = await serviceSupabase
    .from("enterprise_subscriptions")
    .update(updates)
    .eq("enterprise_id", enterpriseId);

  if (reconcileError) {
    console.error("[billing/adjust] Reconciliation DB write failed:", reconcileError);
    // Proceed with Stripe-truth values in memory even if DB write fails
  }

  logEnterpriseAuditAction({
    actorUserId: auditContext.userId,
    actorEmail: auditContext.userEmail,
    action: "billing_reconciled",
    enterpriseId,
    targetType: "subscription",
    targetId: enterpriseId,
    metadata: { driftFields, stripeSubOrgQty, stripeAlumniBucketQty },
    ...extractRequestContext(auditContext.req),
  });

  return {
    ...subscription,
    sub_org_quantity: stripeSubOrgQty ?? subscription.sub_org_quantity,
    alumni_bucket_quantity: stripeAlumniBucketQty ?? subscription.alumni_bucket_quantity,
  };
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise billing adjust",
    limitPerIp: 20,
    limitPerUser: 12,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_BILLING_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Validate request body
  let body: z.infer<typeof adjustQuantitySchema>;
  try {
    body = await validateJson(req, adjustQuantitySchema, { maxBodyBytes: 8_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }

  const { adjustType, newQuantity, expectedCurrentQuantity } = body;

  // Get current subscription
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription, error: subError } = await (ctx.serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("id, enterprise_id, stripe_customer_id, stripe_subscription_id, billing_interval, alumni_bucket_quantity, sub_org_quantity, status, current_period_end")
    .eq("enterprise_id", ctx.enterpriseId)
    .maybeSingle() as { data: EnterpriseSubscriptionRow | null; error: Error | null };

  if (subError) {
    console.error("[billing/adjust] DB error fetching subscription:", subError);
    return respond({ error: "Internal server error" }, 500);
  }

  if (!subscription) {
    return respond({ error: "Enterprise subscription not found" }, 404);
  }

  // Verify Stripe customer exists (required for all adjustments)
  if (!subscription.stripe_customer_id) {
    return respond({ error: "Enterprise subscription is not linked to a Stripe customer" }, 400);
  }

  // Reconcile DB with Stripe metadata to heal any prior Stripe-succeeds-DB-fails drift
  const reconciledSubscription = await reconcileSubscriptionFromStripe(
    ctx.serviceSupabase,
    subscription,
    ctx.enterpriseId,
    { userId: ctx.userId, userEmail: ctx.userEmail, req }
  );

  // ===== SUB-ORG ADJUSTMENT =====
  if (adjustType === "sub_org") {
    // Guard against stale UI state / concurrent updates
    if (expectedCurrentQuantity !== undefined && reconciledSubscription.sub_org_quantity !== expectedCurrentQuantity) {
      return respond(
        {
          error: "Seat quantity changed. Please refresh and try again.",
          currentQuantity: reconciledSubscription.sub_org_quantity,
        },
        409
      );
    }

    // Get current enterprise-managed org count
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: counts, error: countsError } = await (ctx.serviceSupabase as any)
      .from("enterprise_alumni_counts")
      .select("enterprise_managed_org_count")
      .eq("enterprise_id", ctx.enterpriseId)
      .maybeSingle() as { data: EnterpriseManagedCountRow | null; error: Error | null };

    if (countsError) {
      return respond({ error: "Failed to fetch current usage" }, 500);
    }

    const currentManagedOrgCount = counts?.enterprise_managed_org_count ?? 0;

    // Ensure new quantity is not below current usage
    if (newQuantity < currentManagedOrgCount) {
      return respond(
        {
          error: `Cannot reduce seat quantity below current usage. You currently have ${currentManagedOrgCount} enterprise-managed organization(s). Remove some organizations first or choose a quantity of at least ${currentManagedOrgCount}.`,
          currentUsage: currentManagedOrgCount,
          requestedQuantity: newQuantity,
        },
        400
      );
    }

    // Calculate old and new billable counts
    const oldBillable = getBillableOrgCount(reconciledSubscription.sub_org_quantity ?? 0);
    const newBillable = getBillableOrgCount(newQuantity);

    try {
      let periodEnd: string | null = null;
      let updatedStatus = reconciledSubscription.status;

      // Case 1: Was free, staying free (no Stripe subscription needed)
      if (oldBillable === 0 && newBillable === 0) {
        // Just update the quantity in database
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (ctx.serviceSupabase as any)
          .from("enterprise_subscriptions")
          .update({
            sub_org_quantity: newQuantity,
            updated_at: new Date().toISOString(),
          })
          .eq("enterprise_id", ctx.enterpriseId);

        if (updateError) {
          return respond({ error: "Failed to update subscription quantity" }, 500);
        }

        const pricing = getSubOrgPricing(newQuantity, reconciledSubscription.billing_interval);

        logEnterpriseAuditAction({
          actorUserId: ctx.userId,
          actorEmail: ctx.userEmail,
          action: "adjust_billing",
          enterpriseId: ctx.enterpriseId,
          targetType: "subscription",
          targetId: ctx.enterpriseId,
          metadata: { adjustType, newQuantity, previousQuantity: reconciledSubscription.sub_org_quantity },
          ...extractRequestContext(req),
        });

        return respond({
          success: true,
          subscription: {
            quantity: newQuantity,
            currentUsage: currentManagedOrgCount,
            availableSeats: newQuantity - currentManagedOrgCount,
            freeOrgs: pricing.freeOrgs,
            billableOrgs: pricing.billableOrgs,
            totalCents: pricing.totalCents,
            status: updatedStatus,
            currentPeriodEnd: periodEnd,
          },
        });
      }

      // Case 2: Was free, now needs subscription (crossing from 3 to 4+ orgs)
      if (oldBillable === 0 && newBillable > 0) {
        // Get Stripe price ID from env vars
        const priceId = reconciledSubscription.billing_interval === "month"
          ? requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY")
          : requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");

        // If there's already a Stripe subscription, add the sub-org line item
        if (reconciledSubscription.stripe_subscription_id) {
          const updated = await stripe.subscriptions.update(reconciledSubscription.stripe_subscription_id, {
            items: [
              { price: priceId, quantity: newBillable },
            ],
            proration_behavior: "create_prorations",
            metadata: {
              sub_org_quantity: newQuantity.toString(),
            },
          });

          updatedStatus = updated.status;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updatedPeriodEnd = (updated as any).current_period_end;
          periodEnd = updatedPeriodEnd
            ? new Date(updatedPeriodEnd * 1000).toISOString()
            : null;
        } else {
          // No subscription exists (edge case - should have alumni bucket subscription)
          return respond({ error: "No Stripe subscription found. Please contact support." }, 400);
        }
      }

      // Case 3: Was paying, now going back to free tier (3 or fewer orgs)
      else if (oldBillable > 0 && newBillable === 0) {
        // Remove the sub-org line item from subscription
        if (reconciledSubscription.stripe_subscription_id) {
          const stripeSub = await stripe.subscriptions.retrieve(reconciledSubscription.stripe_subscription_id);

          // Find the sub-org line item
          const subOrgItem = stripeSub.items?.data?.find((item) => {
            const priceId = typeof item.price === "string" ? item.price : item.price.id;
            return priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY") ||
                   priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");
          });

          if (subOrgItem) {
            await stripe.subscriptionItems.del(subOrgItem.id, {
              proration_behavior: "create_prorations",
            });
          }

          // Retrieve updated subscription
          const updated = await stripe.subscriptions.retrieve(reconciledSubscription.stripe_subscription_id);
          updatedStatus = updated.status;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updatedPeriodEnd = (updated as any).current_period_end;
          periodEnd = updatedPeriodEnd
            ? new Date(updatedPeriodEnd * 1000).toISOString()
            : null;
        }
      }

      // Case 4: Was paying, still paying (just changing quantity)
      else if (oldBillable > 0 && newBillable > 0 && reconciledSubscription.stripe_subscription_id) {
        // Update existing subscription quantity
        const stripeSub = await stripe.subscriptions.retrieve(reconciledSubscription.stripe_subscription_id);

        // Find the sub-org line item
        const subOrgItem = stripeSub.items?.data?.find((item) => {
          const priceId = typeof item.price === "string" ? item.price : item.price.id;
          return priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY") ||
                 priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");
        });

        if (!subOrgItem) {
          return respond({ error: "Sub-org line item not found in subscription" }, 400);
        }

        const updated = await stripe.subscriptions.update(reconciledSubscription.stripe_subscription_id, {
          items: [{ id: subOrgItem.id, quantity: newBillable }],
          proration_behavior: "create_prorations",
          metadata: {
            sub_org_quantity: newQuantity.toString(),
          },
        });

        updatedStatus = updated.status;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatedPeriodEnd = (updated as any).current_period_end;
        periodEnd = updatedPeriodEnd
          ? new Date(updatedPeriodEnd * 1000).toISOString()
          : null;
      }

      // Update database (with single retry for transient failures)
      const dbWriteFn = () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ctx.serviceSupabase as any)
          .from("enterprise_subscriptions")
          .update({
            sub_org_quantity: newQuantity,
            status: updatedStatus,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("enterprise_id", ctx.enterpriseId) as Promise<{ error: Error | null }>;

      const { error: updateError } = await retryDbWrite(dbWriteFn);

      if (updateError) {
        console.error("[billing/adjust] DB write failed after Stripe update (with retry):", updateError);
        try {
          await logEnterpriseAuditActionAwaited({
            actorUserId: ctx.userId,
            actorEmail: ctx.userEmail,
            action: "billing_db_sync_failure",
            enterpriseId: ctx.enterpriseId,
            targetType: "subscription",
            targetId: ctx.enterpriseId,
            metadata: { adjustType, newQuantity, stripeSubscriptionId: reconciledSubscription.stripe_subscription_id },
            ...extractRequestContext(req),
          });
        } catch (auditError) {
          console.error("[billing/adjust] Failed to record billing_db_sync_failure audit:", auditError);
        }
        return respond({ error: "Billing updated but failed to save. Please contact support." }, 500);
      }

      // Calculate new pricing info
      const pricing = getSubOrgPricing(newQuantity, reconciledSubscription.billing_interval);

      logEnterpriseAuditAction({
        actorUserId: ctx.userId,
        actorEmail: ctx.userEmail,
        action: "adjust_billing",
        enterpriseId: ctx.enterpriseId,
        targetType: "subscription",
        targetId: ctx.enterpriseId,
        metadata: { adjustType, newQuantity, previousQuantity: reconciledSubscription.sub_org_quantity },
        ...extractRequestContext(req),
      });

      return respond({
        success: true,
        subscription: {
          quantity: newQuantity,
          currentUsage: currentManagedOrgCount,
          availableSeats: newQuantity - currentManagedOrgCount,
          freeOrgs: pricing.freeOrgs,
          billableOrgs: pricing.billableOrgs,
          totalCents: pricing.totalCents,
          status: updatedStatus,
          currentPeriodEnd: periodEnd,
        },
      });
    } catch (error) {
      console.error("[billing/adjust] Stripe error (sub_org):", error);
      return respond({ error: "Failed to update subscription" }, 500);
    }
  }

  // ===== ALUMNI BUCKET ADJUSTMENT =====
  if (adjustType === "alumni_bucket") {
    // Validate minimum 1 bucket
    if (newQuantity < 1) {
      return respond({ error: "Alumni bucket quantity must be at least 1" }, 400);
    }

    // Sales-led check
    if (newQuantity > ALUMNI_BUCKET_PRICING.maxSelfServeBuckets) {
      return respond(
        {
          error: "For more than 4 alumni buckets (10,000+ alumni capacity), please contact sales.",
          salesLed: true,
        },
        400
      );
    }

    // Guard against stale UI state
    if (expectedCurrentQuantity !== undefined && reconciledSubscription.alumni_bucket_quantity !== expectedCurrentQuantity) {
      return respond(
        {
          error: "Alumni bucket quantity changed. Please refresh and try again.",
          currentQuantity: reconciledSubscription.alumni_bucket_quantity,
        },
        409
      );
    }

    // Get current alumni count
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: counts, error: countsError } = await (ctx.serviceSupabase as any)
      .from("enterprise_alumni_counts")
      .select("total_alumni_count")
      .eq("enterprise_id", ctx.enterpriseId)
      .maybeSingle() as { data: { total_alumni_count: number } | null; error: Error | null };

    if (countsError) {
      return respond({ error: "Failed to fetch current alumni count" }, 500);
    }

    const currentAlumniCount = counts?.total_alumni_count ?? 0;
    const newCapacity = newQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;

    // Ensure new capacity is sufficient
    if (newCapacity < currentAlumniCount) {
      return respond(
        {
          error: `Cannot reduce alumni bucket capacity below current usage. You currently have ${currentAlumniCount} alumni. New capacity would be ${newCapacity}. Choose a quantity of at least ${Math.ceil(currentAlumniCount / ALUMNI_BUCKET_PRICING.capacityPerBucket)} bucket(s).`,
          currentUsage: currentAlumniCount,
          newCapacity,
          requestedQuantity: newQuantity,
        },
        400
      );
    }

    try {
      let periodEnd: string | null = null;
      let updatedStatus = reconciledSubscription.status;

      // Update Stripe subscription
      if (!reconciledSubscription.stripe_subscription_id) {
        return respond({ error: "No Stripe subscription found. Please contact support." }, 400);
      }

      const stripeSub = await stripe.subscriptions.retrieve(reconciledSubscription.stripe_subscription_id);

      // Find the alumni bucket line item
      const alumniBucketItem = stripeSub.items?.data?.find((item) => {
        const priceId = typeof item.price === "string" ? item.price : item.price.id;
        return priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_MONTHLY") ||
               priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_YEARLY");
      });

      if (!alumniBucketItem) {
        return respond({ error: "Alumni bucket line item not found in subscription" }, 400);
      }

      // Update the alumni bucket quantity
      const updated = await stripe.subscriptions.update(reconciledSubscription.stripe_subscription_id, {
        items: [{ id: alumniBucketItem.id, quantity: newQuantity }],
        proration_behavior: "create_prorations",
        metadata: {
          alumni_bucket_quantity: newQuantity.toString(),
        },
      });

      updatedStatus = updated.status;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatedPeriodEnd = (updated as any).current_period_end;
      periodEnd = updatedPeriodEnd
        ? new Date(updatedPeriodEnd * 1000).toISOString()
        : null;

      // Update database (with single retry for transient failures)
      const dbWriteFn = () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ctx.serviceSupabase as any)
          .from("enterprise_subscriptions")
          .update({
            alumni_bucket_quantity: newQuantity,
            status: updatedStatus,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("enterprise_id", ctx.enterpriseId) as Promise<{ error: Error | null }>;

      const { error: updateError } = await retryDbWrite(dbWriteFn);

      if (updateError) {
        console.error("[billing/adjust] DB write failed after Stripe update (with retry):", updateError);
        try {
          await logEnterpriseAuditActionAwaited({
            actorUserId: ctx.userId,
            actorEmail: ctx.userEmail,
            action: "billing_db_sync_failure",
            enterpriseId: ctx.enterpriseId,
            targetType: "subscription",
            targetId: ctx.enterpriseId,
            metadata: { adjustType, newQuantity, stripeSubscriptionId: reconciledSubscription.stripe_subscription_id },
            ...extractRequestContext(req),
          });
        } catch (auditError) {
          console.error("[billing/adjust] Failed to record billing_db_sync_failure audit:", auditError);
        }
        return respond({ error: "Billing updated but failed to save. Please contact support." }, 500);
      }

      logEnterpriseAuditAction({
        actorUserId: ctx.userId,
        actorEmail: ctx.userEmail,
        action: "adjust_billing",
        enterpriseId: ctx.enterpriseId,
        targetType: "subscription",
        targetId: ctx.enterpriseId,
        metadata: { adjustType, newQuantity, previousQuantity: reconciledSubscription.alumni_bucket_quantity },
        ...extractRequestContext(req),
      });

      return respond({
        success: true,
        alumniBuckets: {
          quantity: newQuantity,
          capacity: newCapacity,
          currentUsage: currentAlumniCount,
          available: newCapacity - currentAlumniCount,
          unitCents: reconciledSubscription.billing_interval === "month"
            ? ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket
            : ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket,
          totalCents: newQuantity * (reconciledSubscription.billing_interval === "month"
            ? ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket
            : ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket),
          status: updatedStatus,
          currentPeriodEnd: periodEnd,
        },
      });
    } catch (error) {
      console.error("[billing/adjust] Stripe error (alumni_bucket):", error);
      return respond({ error: "Failed to update alumni bucket subscription" }, 500);
    }
  }

  return respond({ error: "Invalid adjust type" }, 400);
}
