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
import { getBillableOrgCount, getEnterpriseSubOrgPricing } from "@/lib/enterprise/pricing";
import type { PricingModel } from "@/types/enterprise";
import { ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

const adjustQuantitySchema = z
  .object({
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
  pricing_model: PricingModel | null;
  sub_org_quantity: number | null;
  price_per_sub_org_cents: number | null;
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

  const { newQuantity, expectedCurrentQuantity } = body;

  // Get current subscription
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription, error: subError } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("id, enterprise_id, stripe_customer_id, stripe_subscription_id, billing_interval, pricing_model, sub_org_quantity, price_per_sub_org_cents, status, current_period_end")
    .eq("enterprise_id", resolvedEnterpriseId)
    .maybeSingle() as { data: EnterpriseSubscriptionRow | null; error: Error | null };

  if (subError) {
    return respond({ error: subError.message }, 500);
  }

  if (!subscription) {
    return respond({ error: "Enterprise subscription not found" }, 404);
  }

  // Verify pricing model is per_sub_org
  if (subscription.pricing_model !== "per_sub_org") {
    return respond(
      { error: "Seat quantity adjustment is only available for per-sub-org pricing. Please contact support to upgrade your pricing model." },
      400
    );
  }

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

  // Verify Stripe customer exists (required for both setup mode and subscription mode)
  if (!subscription.stripe_customer_id) {
    return respond({ error: "Enterprise subscription is not linked to a Stripe customer" }, 400);
  }

  try {
    let periodEnd: string | null = null;
    let updatedStatus = subscription.status;
    let stripeSubscriptionId = subscription.stripe_subscription_id;

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
        console.error("[enterprise-billing-adjust] Failed to update database:", updateError);
      }

      const pricing = getEnterpriseSubOrgPricing(newQuantity);

      logEnterpriseAuditAction({
        actorUserId: user.id,
        actorEmail: user.email ?? "",
        action: "adjust_billing",
        enterpriseId: resolvedEnterpriseId,
        targetType: "subscription",
        targetId: resolvedEnterpriseId,
        metadata: { newQuantity, previousQuantity: subscription.sub_org_quantity },
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
          totalCentsYearly: pricing.totalCentsYearly,
          status: updatedStatus,
          currentPeriodEnd: periodEnd,
        },
      });
    }

    // Case 2: Was free, now needs subscription (crossing from 5 to 6+ orgs)
    if (oldBillable === 0 && newBillable > 0) {
      // Determine price based on billing interval
      const billingInterval = subscription.billing_interval;
      const unitAmount = billingInterval === "month"
        ? ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly
        : ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;

      // Create a price for the subscription
      const price = await stripe.prices.create({
        currency: "usd",
        unit_amount: unitAmount,
        recurring: { interval: billingInterval },
        product_data: {
          name: "Enterprise Additional Organization",
          metadata: {
            description: `TeamNetwork Enterprise - Additional organizations beyond free tier (${ENTERPRISE_SEAT_PRICING.freeSubOrgs} free included)`,
          },
        },
      });

      // Create subscription with billable quantity
      const newSub = await stripe.subscriptions.create({
        customer: subscription.stripe_customer_id,
        items: [
          {
            price: price.id,
            quantity: newBillable,
          },
        ],
        metadata: {
          type: "enterprise",
          pricing_model: "per_sub_org",
          sub_org_quantity: newQuantity.toString(),
          enterprise_id: resolvedEnterpriseId,
        },
      });

      stripeSubscriptionId = newSub.id;
      updatedStatus = newSub.status;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const periodEndVal = (newSub as any).current_period_end;
      periodEnd = periodEndVal
        ? new Date(periodEndVal * 1000).toISOString()
        : null;
    }

    // Case 3: Was paying, now going back to free tier (5 or fewer orgs)
    else if (oldBillable > 0 && newBillable === 0) {
      // Cancel the subscription
      if (subscription.stripe_subscription_id) {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
        stripeSubscriptionId = null;
        updatedStatus = "active"; // Still active, just free now
      }
    }

    // Case 4: Was paying, still paying (just changing quantity)
    else if (oldBillable > 0 && newBillable > 0 && subscription.stripe_subscription_id) {
      // Update existing subscription quantity
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      const itemId = stripeSub.items?.data?.[0]?.id;

      if (!itemId) {
        return respond({ error: "Stripe subscription items not found" }, 400);
      }

      const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        items: [{ id: itemId, quantity: newBillable }],
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
        stripe_subscription_id: stripeSubscriptionId,
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
    const pricing = getEnterpriseSubOrgPricing(newQuantity);

    logEnterpriseAuditAction({
      actorUserId: user.id,
      actorEmail: user.email ?? "",
      action: "adjust_billing",
      enterpriseId: resolvedEnterpriseId,
      targetType: "subscription",
      targetId: resolvedEnterpriseId,
      metadata: { newQuantity, previousQuantity: subscription.sub_org_quantity },
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
        totalCentsYearly: pricing.totalCentsYearly,
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
