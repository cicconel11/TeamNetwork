import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { requireEnterpriseBillingAccess } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
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

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const serviceSupabase = createServiceClient();
  const { data: resolved, error: resolveError } = await resolveEnterpriseParam(enterpriseId, serviceSupabase);
  if (resolveError) {
    return respond({ error: resolveError.message }, resolveError.status);
  }

  const resolvedEnterpriseId = resolved?.enterpriseId ?? enterpriseId;

  try {
    // Require owner or billing_admin role
    await requireEnterpriseBillingAccess(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

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
  const { data: subscription, error: subError } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("id, enterprise_id, stripe_customer_id, stripe_subscription_id, billing_interval, alumni_bucket_quantity, sub_org_quantity, status, current_period_end")
    .eq("enterprise_id", resolvedEnterpriseId)
    .maybeSingle() as { data: EnterpriseSubscriptionRow | null; error: Error | null };

  if (subError) {
    return respond({ error: subError.message }, 500);
  }

  if (!subscription) {
    return respond({ error: "Enterprise subscription not found" }, 404);
  }

  // Verify Stripe customer exists (required for all adjustments)
  if (!subscription.stripe_customer_id) {
    return respond({ error: "Enterprise subscription is not linked to a Stripe customer" }, 400);
  }

  // ===== SUB-ORG ADJUSTMENT =====
  if (adjustType === "sub_org") {
    // Guard against stale UI state / concurrent updates
    if (expectedCurrentQuantity !== undefined && subscription.sub_org_quantity !== expectedCurrentQuantity) {
      return respond(
        {
          error: "Seat quantity changed. Please refresh and try again.",
          currentQuantity: subscription.sub_org_quantity,
        },
        409
      );
    }

    // Get current enterprise-managed org count
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: counts, error: countsError } = await (serviceSupabase as any)
      .from("enterprise_alumni_counts")
      .select("enterprise_managed_org_count")
      .eq("enterprise_id", resolvedEnterpriseId)
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
    const oldBillable = getBillableOrgCount(subscription.sub_org_quantity ?? 0);
    const newBillable = getBillableOrgCount(newQuantity);

    try {
      let periodEnd: string | null = null;
      let updatedStatus = subscription.status;

      // Case 1: Was free, staying free (no Stripe subscription needed)
      if (oldBillable === 0 && newBillable === 0) {
        // Just update the quantity in database
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (serviceSupabase as any)
          .from("enterprise_subscriptions")
          .update({
            sub_org_quantity: newQuantity,
            updated_at: new Date().toISOString(),
          })
          .eq("enterprise_id", resolvedEnterpriseId);

        if (updateError) {
          return respond({ error: "Failed to update subscription quantity" }, 500);
        }

        const pricing = getSubOrgPricing(newQuantity, subscription.billing_interval);

        logEnterpriseAuditAction({
          actorUserId: user.id,
          actorEmail: user.email ?? "",
          action: "adjust_billing",
          enterpriseId: resolvedEnterpriseId,
          targetType: "subscription",
          targetId: resolvedEnterpriseId,
          metadata: { adjustType, newQuantity, previousQuantity: subscription.sub_org_quantity },
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
        const priceId = subscription.billing_interval === "month"
          ? requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY")
          : requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");

        // If there's already a Stripe subscription, add the sub-org line item
        if (subscription.stripe_subscription_id) {
          const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
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
        if (subscription.stripe_subscription_id) {
          const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);

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
          const updated = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
          updatedStatus = updated.status;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updatedPeriodEnd = (updated as any).current_period_end;
          periodEnd = updatedPeriodEnd
            ? new Date(updatedPeriodEnd * 1000).toISOString()
            : null;
        }
      }

      // Case 4: Was paying, still paying (just changing quantity)
      else if (oldBillable > 0 && newBillable > 0 && subscription.stripe_subscription_id) {
        // Update existing subscription quantity
        const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);

        // Find the sub-org line item
        const subOrgItem = stripeSub.items?.data?.find((item) => {
          const priceId = typeof item.price === "string" ? item.price : item.price.id;
          return priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_MONTHLY") ||
                 priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_SUB_ORG_YEARLY");
        });

        if (!subOrgItem) {
          return respond({ error: "Sub-org line item not found in subscription" }, 400);
        }

        const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
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

      // Update database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (serviceSupabase as any)
        .from("enterprise_subscriptions")
        .update({
          sub_org_quantity: newQuantity,
          status: updatedStatus,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("enterprise_id", resolvedEnterpriseId);

      if (updateError) {
        // Log error but don't fail - Stripe is source of truth
        console.error("[enterprise-billing-adjust] Failed to update database:", updateError);
      }

      // Calculate new pricing info
      const pricing = getSubOrgPricing(newQuantity, subscription.billing_interval);

      logEnterpriseAuditAction({
        actorUserId: user.id,
        actorEmail: user.email ?? "",
        action: "adjust_billing",
        enterpriseId: resolvedEnterpriseId,
        targetType: "subscription",
        targetId: resolvedEnterpriseId,
        metadata: { adjustType, newQuantity, previousQuantity: subscription.sub_org_quantity },
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
      const message = error instanceof Error ? error.message : "Failed to update subscription";
      console.error("[enterprise-billing-adjust] Stripe error:", error);
      return respond({ error: message }, 500);
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
    if (expectedCurrentQuantity !== undefined && subscription.alumni_bucket_quantity !== expectedCurrentQuantity) {
      return respond(
        {
          error: "Alumni bucket quantity changed. Please refresh and try again.",
          currentQuantity: subscription.alumni_bucket_quantity,
        },
        409
      );
    }

    // Get current alumni count
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: counts, error: countsError } = await (serviceSupabase as any)
      .from("enterprise_alumni_counts")
      .select("total_alumni_count")
      .eq("enterprise_id", resolvedEnterpriseId)
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
      let updatedStatus = subscription.status;

      // Update Stripe subscription
      if (!subscription.stripe_subscription_id) {
        return respond({ error: "No Stripe subscription found. Please contact support." }, 400);
      }

      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);

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
      const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
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

      // Update database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (serviceSupabase as any)
        .from("enterprise_subscriptions")
        .update({
          alumni_bucket_quantity: newQuantity,
          status: updatedStatus,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("enterprise_id", resolvedEnterpriseId);

      if (updateError) {
        console.error("[enterprise-billing-adjust] Failed to update database:", updateError);
      }

      logEnterpriseAuditAction({
        actorUserId: user.id,
        actorEmail: user.email ?? "",
        action: "adjust_billing",
        enterpriseId: resolvedEnterpriseId,
        targetType: "subscription",
        targetId: resolvedEnterpriseId,
        metadata: { adjustType, newQuantity, previousQuantity: subscription.alumni_bucket_quantity },
        ...extractRequestContext(req),
      });

      return respond({
        success: true,
        alumniBuckets: {
          quantity: newQuantity,
          capacity: newCapacity,
          currentUsage: currentAlumniCount,
          available: newCapacity - currentAlumniCount,
          unitCents: subscription.billing_interval === "month"
            ? ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket
            : ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket,
          totalCents: newQuantity * (subscription.billing_interval === "month"
            ? ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket
            : ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket),
          status: updatedStatus,
          currentPeriodEnd: periodEnd,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update alumni bucket subscription";
      console.error("[enterprise-billing-adjust] Stripe error:", error);
      return respond({ error: message }, 500);
    }
  }

  return respond({ error: "Invalid adjust type" }, 400);
}
