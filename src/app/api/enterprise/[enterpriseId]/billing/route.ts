import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { requireEnterpriseBillingAccess } from "@/lib/auth/enterprise-roles";
import { getEnterpriseQuota } from "@/lib/enterprise/quota";
import { getAlumniBucketPricing, getSubOrgPricing, isSalesLed } from "@/lib/enterprise/pricing";
import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";
import type { BillingInterval } from "@/types/enterprise";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";
import { requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for enterprise subscription row (until types are regenerated)
interface EnterpriseSubscriptionRow {
  id: string;
  enterprise_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: BillingInterval;
  alumni_bucket_quantity: number;
  sub_org_quantity: number | null;
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

  // Calculate pricing
  const bucketQuantity = subscription.alumni_bucket_quantity;
  const salesManaged = isSalesLed(bucketQuantity);
  const subOrgPricing = getSubOrgPricing(
    subscription.sub_org_quantity ?? 0,
    subscription.billing_interval
  );

  // Build billing overview
  const billing = {
    salesManaged,
    status: subscription.status,
    billingInterval: subscription.billing_interval,
    alumniBucketQuantity: bucketQuantity,
    alumniCapacity: bucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket,
    subOrgQuantity: subscription.sub_org_quantity ?? null,
    stripeCustomerId: subscription.stripe_customer_id,
    stripeSubscriptionId: subscription.stripe_subscription_id,
    currentPeriodEnd: subscription.current_period_end,
    gracePeriodEndsAt: subscription.grace_period_ends_at,
    pricing: salesManaged
      ? {
          alumni: { mode: "sales_managed" as const, unitCents: null, totalCents: null, capacity: null },
          subOrgs: subOrgPricing,
          totalCents: null,
        }
      : (() => {
          const alumniPricing = getAlumniBucketPricing(bucketQuantity, subscription.billing_interval);
          return {
            alumni: { mode: "self_serve" as const, ...alumniPricing },
            subOrgs: subOrgPricing,
            totalCents: alumniPricing.totalCents + subOrgPricing.totalCents,
          };
        })(),
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

const updateBucketSchema = z
  .object({
    alumniBucketQuantity: z.number().int().min(1).max(4),
  })
  .strict();

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

  let body: z.infer<typeof updateBucketSchema>;
  try {
    body = await validateJson(req, updateBucketSchema, { maxBodyBytes: 8_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }

  const { alumniBucketQuantity } = body;

  // Sales-led check
  if (alumniBucketQuantity > ALUMNI_BUCKET_PRICING.maxSelfServeBuckets) {
    return respond(
      { error: "Enterprise plans with more than 4 alumni buckets require custom pricing. Please contact sales." },
      400
    );
  }

  const quota = await getEnterpriseQuota(resolvedEnterpriseId);
  if (!quota) {
    return respond({ error: "Enterprise subscription not found" }, 404);
  }

  // Ensure new capacity covers current alumni count
  const targetCapacity = alumniBucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;
  if (quota.alumniCount > targetCapacity) {
    return respond(
      { error: `Your current alumni count (${quota.alumniCount}) exceeds this bucket's capacity (${targetCapacity}). Choose a higher bucket quantity.` },
      400,
    );
  }

  // Load current subscription info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription, error: subError } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, alumni_bucket_quantity, billing_interval")
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

    // Find the alumni bucket line item
    const alumniBucketItem = stripeSub.items?.data?.find((item) => {
      const priceId = typeof item.price === "string" ? item.price : item.price.id;
      return priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_MONTHLY") ||
             priceId === requireEnv("STRIPE_PRICE_ENTERPRISE_ALUMNI_BUCKET_YEARLY");
    });

    if (!alumniBucketItem) {
      return respond({ error: "Alumni bucket line item not found in subscription." }, 400);
    }

    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{ id: alumniBucketItem.id, quantity: alumniBucketQuantity }],
      proration_behavior: "create_prorations",
      metadata: {
        alumni_bucket_quantity: alumniBucketQuantity.toString(),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedSub = updated as any;
    const periodEnd = updatedSub.current_period_end ? new Date(updatedSub.current_period_end * 1000).toISOString() : null;
    const stripeCustomerId =
      typeof updatedSub.customer === "string" ? updatedSub.customer : updatedSub.customer?.id || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (serviceSupabase as any)
      .from("enterprise_subscriptions")
      .update({
        alumni_bucket_quantity: alumniBucketQuantity,
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
