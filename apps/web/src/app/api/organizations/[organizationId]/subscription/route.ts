import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAlumniLimit, normalizeBucket } from "@/lib/alumni-quota";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { z } from "zod";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type PriceLookup = {
  priceId: string;
  bucket: AlumniBucket;
  interval: SubscriptionInterval;
  type: "base" | "alumni";
};

function isInvalidSubscriptionError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("No such subscription");
  }
  return false;
}

async function clearInvalidSubscription(
  organizationId: string,
  serviceSupabase: ReturnType<typeof createServiceClient>
) {
  console.log("[subscription] Clearing invalid subscription ID for org:", organizationId);
  await serviceSupabase
    .from("organization_subscriptions")
    .update({
      stripe_subscription_id: null,
      stripe_customer_id: null,
      status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);
}

async function ensureStripeCustomerId(params: {
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  organizationId: string;
  serviceSupabase: ReturnType<typeof createServiceClient>;
}): Promise<{ customerId: string | null; subscriptionInvalid: boolean }> {
  if (params.stripeCustomerId || !params.stripeSubscriptionId) {
    return { customerId: params.stripeCustomerId ?? null, subscriptionInvalid: false };
  }
  try {
    const { stripe } = await import("@/lib/stripe");
    const sub = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;
    if (customerId) {
      await params.serviceSupabase
        .from("organization_subscriptions")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("organization_id", params.organizationId);
    }
    return { customerId, subscriptionInvalid: false };
  } catch (error) {
    console.error("[subscription] Unable to backfill stripe_customer_id", error);
    if (isInvalidSubscriptionError(error)) {
      await clearInvalidSubscription(params.organizationId, params.serviceSupabase);
      return { customerId: null, subscriptionInvalid: true };
    }
    return { customerId: null, subscriptionInvalid: false };
  }
}

async function ensureStripePlan(params: {
  stripeSubscriptionId?: string | null;
  currentBucket: AlumniBucket;
  currentBaseInterval: SubscriptionInterval;
  organizationId: string;
  serviceSupabase: ReturnType<typeof createServiceClient>;
}): Promise<{ bucket: AlumniBucket; baseInterval: SubscriptionInterval; subscriptionInvalid: boolean }> {
  if (!params.stripeSubscriptionId) {
    return {
      bucket: params.currentBucket,
      baseInterval: params.currentBaseInterval,
      subscriptionInvalid: false,
    };
  }

  try {
    const { stripe, getPriceIds } = await import("@/lib/stripe");
    const priceMap: PriceLookup[] = [];
    const intervals: SubscriptionInterval[] = ["month", "year"];
    const buckets: AlumniBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000"];

    intervals.forEach((interval) => {
      buckets.forEach((bucket) => {
        const { basePrice, alumniPrice } = getPriceIds(interval, bucket);
        priceMap.push({ priceId: basePrice, bucket, interval, type: "base" });
        if (alumniPrice) {
          priceMap.push({ priceId: alumniPrice, bucket, interval, type: "alumni" });
        }
      });
    });

    const subscription = (await stripe.subscriptions.retrieve(params.stripeSubscriptionId, {
      expand: ["items.data.price"],
    })) as Stripe.Subscription;

    const items = subscription.items?.data ?? [];
    let detectedBucket: AlumniBucket | null = null;
    let detectedInterval: SubscriptionInterval | null = null;

    for (const item of items) {
      const priceId = item.price?.id;
      if (!priceId) continue;
      const match = priceMap.find((p) => p.priceId === priceId && p.type === "alumni");
      const baseMatch = priceMap.find((p) => p.priceId === priceId && p.type === "base");
      if (match && !detectedBucket) {
        detectedBucket = match.bucket;
        detectedInterval = match.interval;
      }
      if (baseMatch && !detectedInterval) {
        detectedInterval = baseMatch.interval;
      }
    }

    const bucket = detectedBucket ?? params.currentBucket;
    const baseInterval = detectedInterval ?? params.currentBaseInterval;
    await params.serviceSupabase
      .from("organization_subscriptions")
      .update({
        alumni_bucket: bucket,
        base_plan_interval: baseInterval,
        alumni_plan_interval: bucket === "none" ? null : baseInterval,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", params.organizationId);

    return { bucket, baseInterval, subscriptionInvalid: false };
  } catch (error) {
    console.error("[subscription] Unable to backfill plan details", error);
    if (isInvalidSubscriptionError(error)) {
      await clearInvalidSubscription(params.organizationId, params.serviceSupabase);
      return {
        bucket: params.currentBucket,
        baseInterval: params.currentBaseInterval,
        subscriptionInvalid: true,
      };
    }
    return {
      bucket: params.currentBucket,
      baseInterval: params.currentBaseInterval,
      subscriptionInvalid: false,
    };
  }
}

const postSchema = z
  .object({
    alumniBucket: z.enum(["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"]),
  })
  .strict();

async function requireAdmin(req: Request, orgId: string, rateLimitLabel: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: rateLimitLabel,
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return { error: buildRateLimitResponse(rateLimit) };
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return { error: respond({ error: "Unauthorized" }, 401) };
  }

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (role?.role !== "admin") {
    return { error: respond({ error: "Forbidden" }, 403) };
  }

  return { supabase, user, respond, rateLimit };
}

function buildQuotaResponse(params: {
  bucket: AlumniBucket;
  alumniLimit: number | null;
  alumniCount: number;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
}, respond: (payload: unknown, status?: number) => ReturnType<typeof NextResponse.json>) {
  const remaining = params.alumniLimit === null ? null : Math.max(params.alumniLimit - params.alumniCount, 0);
  return respond({
    bucket: params.bucket,
    alumniLimit: params.alumniLimit,
    alumniCount: params.alumniCount,
    remaining,
    status: params.status,
    stripeSubscriptionId: params.stripeSubscriptionId,
    stripeCustomerId: params.stripeCustomerId,
    currentPeriodEnd: params.currentPeriodEnd,
  });
}

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const auth = await requireAdmin(req, organizationId, "subscription lookup");
  if ("error" in auth) return auth.error;

  const { respond } = auth;
  const serviceSupabase = createServiceClient();
  const { data: sub, error: subError } = await serviceSupabase
    .from("organization_subscriptions")
    .select("alumni_bucket, status, base_plan_interval, stripe_subscription_id, stripe_customer_id, current_period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (subError) {
    console.error("[subscription] Failed to load subscription", subError);
    return respond({ error: "Unable to load subscription details" }, 500);
  }

  const { count: alumniCountRaw, error: countError } = await serviceSupabase
    .from("alumni")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  const alumniCount = countError ? 0 : alumniCountRaw ?? 0;
  const bucket = normalizeBucket(
    (sub?.alumni_bucket as string | null) ??
    "none",
  );
  const baseInterval: SubscriptionInterval =
    sub?.base_plan_interval === "year" ? "year" : "month";

  const planDetails = await ensureStripePlan({
    stripeSubscriptionId: sub?.stripe_subscription_id as string | null,
    currentBucket: bucket,
    currentBaseInterval: baseInterval,
    organizationId,
    serviceSupabase,
  });

  // If subscription was found to be invalid, return as if no subscription exists
  if (planDetails.subscriptionInvalid) {
    const alumniLimit = getAlumniLimit(planDetails.bucket);
    return buildQuotaResponse({
      bucket: planDetails.bucket,
      alumniLimit,
      alumniCount,
      status: "canceled",
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      currentPeriodEnd: null,
    }, respond);
  }

  const alumniLimit = getAlumniLimit(planDetails.bucket);
  const status = (sub?.status as string | undefined) ?? "pending";
  const customerResult = await ensureStripeCustomerId({
    stripeSubscriptionId: sub?.stripe_subscription_id as string | null,
    stripeCustomerId: sub?.stripe_customer_id as string | null,
    organizationId,
    serviceSupabase,
  });

  // If subscription was found to be invalid during customer lookup, return as if no subscription exists
  if (customerResult.subscriptionInvalid) {
    return buildQuotaResponse({
      bucket: planDetails.bucket,
      alumniLimit,
      alumniCount,
      status: "canceled",
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      currentPeriodEnd: null,
    }, respond);
  }

  return buildQuotaResponse({
    bucket: planDetails.bucket,
    alumniLimit,
    alumniCount,
    status,
    stripeSubscriptionId: (sub?.stripe_subscription_id as string | null) ?? null,
    stripeCustomerId: customerResult.customerId,
    currentPeriodEnd: (sub?.current_period_end as string | null) ?? null,
  }, respond);
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { organizationId } = await params;
    const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
    if (!orgIdParsed.success) {
      return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
    }

    const auth = await requireAdmin(req, organizationId, "subscription update");
    if ("error" in auth) return auth.error;

    const { respond } = auth;
    const { stripe, getPriceIds } = await import("@/lib/stripe");
    let body: z.infer<typeof postSchema>;
    try {
      body = await validateJson(req, postSchema);
    } catch (error) {
      if (error instanceof ValidationError) {
        return auth.respond({ error: error.message, details: error.details }, 400);
      }
      throw error;
    }

    const targetBucket = normalizeBucket(body.alumniBucket);
    if (targetBucket === "5000+") {
      return respond(
        { error: "Contact support to manage the 5000+ alumni plan." },
        400,
      );
    }

    const serviceSupabase = createServiceClient();
    const { data: sub, error: subError } = await serviceSupabase
      .from("organization_subscriptions")
      .select("stripe_subscription_id, stripe_customer_id, base_plan_interval, alumni_bucket, status, current_period_end")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (subError) {
      console.error("[subscription] Failed to load subscription", subError);
      return respond(
        { error: "Unable to load subscription details" },
        500,
      );
    }

    const customerResult = await ensureStripeCustomerId({
      stripeSubscriptionId: sub?.stripe_subscription_id as string | null,
      stripeCustomerId: sub?.stripe_customer_id as string | null,
      organizationId,
      serviceSupabase,
    });

    // If subscription was found to be invalid, tell user to start fresh checkout
    if (customerResult.subscriptionInvalid) {
      return respond(
        { error: "Your subscription is no longer active. Please start a new subscription." },
        400,
      );
    }

    if (!sub?.stripe_subscription_id || !customerResult.customerId) {
      return respond(
        { error: "Billing is not set up for this organization." },
        400,
      );
    }

    const interval: SubscriptionInterval =
      sub?.base_plan_interval === "year" ? "year" : "month";
    const currentBucket = normalizeBucket(sub?.alumni_bucket as string | null);

    const { count: alumniCountRaw, error: countError } = await serviceSupabase
      .from("alumni")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    const alumniCount = countError ? 0 : alumniCountRaw ?? 0;

    const baseInterval: SubscriptionInterval =
      sub?.base_plan_interval === "year" ? "year" : "month";

    const planDetails = await ensureStripePlan({
      stripeSubscriptionId: sub?.stripe_subscription_id as string | null,
      currentBucket: currentBucket,
      currentBaseInterval: baseInterval,
      organizationId,
      serviceSupabase,
    });

    if (currentBucket === targetBucket) {
      const alumniLimit = getAlumniLimit(targetBucket);
      return buildQuotaResponse({
        bucket: planDetails.bucket,
        alumniLimit,
        alumniCount,
        status: (sub?.status as string | undefined) ?? "active",
        stripeSubscriptionId: sub.stripe_subscription_id as string,
        stripeCustomerId: customerResult.customerId,
        currentPeriodEnd: (sub?.current_period_end as string | null) ?? null,
      }, respond);
    }

    const targetLimit = getAlumniLimit(targetBucket);
    if (targetLimit !== null && alumniCount > targetLimit) {
      return respond(
        { error: "You are above the alumni limit for that plan. Remove alumni or choose a larger bucket." },
        400,
      );
    }

    const { basePrice, alumniPrice } = getPriceIds(interval, targetBucket);

    try {
      const subscription = (await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
        expand: ["items.data.price"],
      })) as Stripe.Subscription;

      const items = subscription.items?.data ?? [];
      const baseItem = items.find((item) => item.price?.id === basePrice) ?? items[0];

      if (!baseItem) {
        return respond(
          { error: "Unable to locate base subscription item. Please contact support." },
          400,
        );
      }

      const otherItems = items.filter((item) => item.id !== baseItem.id);
      const addOnItem = otherItems.find((item) => item.price?.id !== basePrice) ?? null;
      const preservedItems = otherItems.filter((item) => item.id !== addOnItem?.id);

      const updateItems: Stripe.SubscriptionUpdateParams.Item[] = [
        { id: baseItem.id, price: basePrice, quantity: 1 },
        ...preservedItems
          .filter((item) => item.price?.id)
          .map((item) => ({
            id: item.id,
            price: (item.price?.id as string) ?? undefined,
            quantity: item.quantity ?? 1,
          })),
      ];

      if (alumniPrice) {
        if (addOnItem) {
          updateItems.push({ id: addOnItem.id, price: alumniPrice, quantity: 1 });
        } else {
          updateItems.push({ price: alumniPrice, quantity: 1 });
        }
      } else if (addOnItem) {
        updateItems.push({ id: addOnItem.id, deleted: true });
      }

      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        items: updateItems,
        metadata: {
          ...(subscription.metadata || {}),
          alumni_bucket: targetBucket,
        },
        proration_behavior: "create_prorations",
      });

      const alumniPlanInterval = targetBucket === "none" ? null : interval;
      await serviceSupabase
        .from("organization_subscriptions")
        .update({
          alumni_bucket: targetBucket,
          alumni_plan_interval: alumniPlanInterval,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId);

      return buildQuotaResponse({
        bucket: targetBucket,
        alumniLimit: targetLimit,
        alumniCount,
        status: (sub?.status as string | undefined) ?? "active",
        stripeSubscriptionId: sub.stripe_subscription_id as string,
        stripeCustomerId: sub.stripe_customer_id as string,
        currentPeriodEnd: (sub?.current_period_end as string | null) ?? null,
      }, respond);
    } catch (error) {
      console.error("[subscription-update] Failed to update subscription", error);
      const message = error instanceof Error ? error.message : "Unable to update subscription";
      return respond({ error: message }, 400);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
