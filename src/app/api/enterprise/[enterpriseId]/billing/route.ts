import { NextResponse } from "next/server";
import { z } from "zod";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { requireEnterpriseBillingAccess } from "@/lib/auth/enterprise-roles";
import { getEnterpriseQuota } from "@/lib/enterprise/quota";
import { formatTierName, getEnterprisePricing, getEnterpriseTierLimit } from "@/lib/enterprise/pricing";
import type { EnterpriseTier, BillingInterval, PricingModel } from "@/types/enterprise";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

// Extended Stripe type to include current_period_end
type SubscriptionWithPeriod = Stripe.Subscription & {
  current_period_end?: number | null;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

const updatePlanSchema = z
  .object({
    tier: z.enum(["tier_1", "tier_2", "tier_3", "custom"]),
    interval: z.enum(["month", "year"]),
  })
  .strict();

// Type for enterprise subscription row (until types are regenerated)
interface EnterpriseSubscriptionRow {
  id: string;
  enterprise_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: BillingInterval;
  alumni_tier: EnterpriseTier;
  pricing_model: PricingModel | null;
  sub_org_quantity: number | null;
  pooled_alumni_limit: number | null;
  custom_price_cents: number | null;
  status: string;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise billing",
    limitPerIp: 60,
    limitPerUser: 40,
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

  // Get subscription details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription, error: subError } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("*")
    .eq("enterprise_id", resolvedEnterpriseId)
    .maybeSingle() as { data: EnterpriseSubscriptionRow | null; error: Error | null };

  if (subError) {
    return respond({ error: subError.message }, 400);
  }

  if (!subscription) {
    return respond({ error: "Enterprise subscription not found" }, 404);
  }

  // Get quota info
  const quota = await getEnterpriseQuota(resolvedEnterpriseId);

  // Build billing overview
  const billing = {
    status: subscription.status,
    tier: subscription.alumni_tier,
    tierName: formatTierName(subscription.alumni_tier),
    billingInterval: subscription.billing_interval,
    pricingModel: subscription.pricing_model ?? "alumni_tier",
    subOrgQuantity: subscription.sub_org_quantity ?? null,
    stripeCustomerId: subscription.stripe_customer_id,
    stripeSubscriptionId: subscription.stripe_subscription_id,
    currentPeriodEnd: subscription.current_period_end,
    gracePeriodEndsAt: subscription.grace_period_ends_at,
    usage: quota
      ? {
          alumniCount: quota.alumniCount,
          alumniLimit: quota.alumniLimit,
          remaining: quota.remaining,
          subOrgCount: quota.subOrgCount,
          percentUsed:
            quota.alumniLimit !== null
              ? Math.round((quota.alumniCount / quota.alumniLimit) * 100)
              : null,
        }
      : null,
  };

  return respond({ billing });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise billing update",
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

  let body: z.infer<typeof updatePlanSchema>;
  try {
    body = await validateJson(req, updatePlanSchema, { maxBodyBytes: 8_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }

  const { tier, interval } = body;
  const priceCents = getEnterprisePricing(tier, interval);
  if (priceCents === null) {
    return respond({ error: "This tier requires custom pricing. Please contact sales." }, 400);
  }

  const quota = await getEnterpriseQuota(resolvedEnterpriseId);
  if (!quota) {
    return respond({ error: "Enterprise subscription not found" }, 404);
  }

  const targetLimit = getEnterpriseTierLimit(tier);
  if (targetLimit !== null && quota.alumniCount > targetLimit) {
    return respond(
      { error: "Your current alumni count exceeds this tier's limit. Choose a higher tier." },
      400,
    );
  }

  // Load current subscription info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription, error: subError } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("stripe_subscription_id, stripe_customer_id")
    .eq("enterprise_id", resolvedEnterpriseId)
    .maybeSingle() as { data: EnterpriseSubscriptionRow | null; error: Error | null };

  if (subError) {
    return respond({ error: subError.message }, 400);
  }

  if (!subscription?.stripe_subscription_id) {
    return respond({ error: "Enterprise subscription is not linked to Stripe." }, 400);
  }

  try {
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    const itemId = stripeSub.items?.data?.[0]?.id;
    if (!itemId) {
      return respond({ error: "Stripe subscription items not found." }, 400);
    }

    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: priceCents,
      recurring: { interval: interval === "year" ? "year" : "month" },
      product_data: {
        name: `Enterprise Plan - ${formatTierName(tier)}`,
      },
    });

    const updated = (await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{ id: itemId, price: price.id }],
      proration_behavior: "create_prorations",
    })) as SubscriptionWithPeriod;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedSub = updated as any;
    const periodEnd = updatedSub.current_period_end ? new Date(updatedSub.current_period_end * 1000).toISOString() : null;
    const stripeCustomerId =
      typeof updatedSub.customer === "string" ? updatedSub.customer : updatedSub.customer?.id || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (serviceSupabase as any)
      .from("enterprise_subscriptions")
      .update({
        alumni_tier: tier,
        billing_interval: interval,
        pooled_alumni_limit: getEnterpriseTierLimit(tier),
        custom_price_cents: null,
        status: updated.status,
        current_period_end: periodEnd,
        stripe_customer_id: stripeCustomerId ?? subscription.stripe_customer_id,
        updated_at: new Date().toISOString(),
      })
      .eq("enterprise_id", resolvedEnterpriseId);

    if (updateError) {
      console.error("[enterprise-billing] Failed to update subscription record", updateError);
      return respond(
        { error: "Stripe updated successfully, but billing record update failed. Please refresh or contact support." },
        500,
      );
    }

    return respond({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update subscription";
    return respond({ error: message }, 400);
  }
}
