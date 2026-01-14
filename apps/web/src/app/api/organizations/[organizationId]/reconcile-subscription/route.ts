import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

type SubscriptionWithPeriod = Stripe.Subscription & {
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
};

const normalizeSubscriptionStatus = (subscription: { status?: string | null; cancel_at_period_end?: boolean | null }) => {
  const status = subscription.status || "canceled";
  if (subscription.cancel_at_period_end && status !== "canceled") {
    return "canceling";
  }
  return status;
};

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "subscription reconcile",
    limitPerIp: 15,
    limitPerUser: 8,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const serviceSupabase = createServiceClient();

  const { data: subscriptionRow } = await serviceSupabase
    .from("organization_subscriptions")
    .select("status, stripe_subscription_id, stripe_customer_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!subscriptionRow) {
    return respond({ error: "Subscription not found" }, 404);
  }

  if (subscriptionRow.stripe_subscription_id && subscriptionRow.stripe_customer_id) {
    return respond({ status: subscriptionRow.status || "active" });
  }

  const { data: paymentAttempts } = await serviceSupabase
    .from("payment_attempts")
    .select("id, stripe_checkout_session_id, status, organization_id, metadata")
    .in("status", ["succeeded", "processing"])
    .or(`organization_id.eq.${organizationId},metadata->>pending_org_id.eq.${organizationId}`)
    .order("created_at", { ascending: false })
    .limit(1);

  const attempt = paymentAttempts?.[0];
  if (!attempt?.stripe_checkout_session_id) {
    return respond({ error: "No completed checkout session found for this organization." }, 404);
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(attempt.stripe_checkout_session_id, {
      expand: ["subscription", "customer"],
    });

    const subscriptionId = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || null;
    const customerId = typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

    if (!subscriptionId || !customerId) {
      return respond({ error: "Checkout session missing subscription or customer details." }, 400);
    }

    const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as SubscriptionWithPeriod;
    const currentPeriodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
    const status = normalizeSubscriptionStatus({
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
    });

    const payload: Database["public"]["Tables"]["organization_subscriptions"]["Update"] = {
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      status,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    await serviceSupabase
      .from("organization_subscriptions")
      .update(payload)
      .eq("organization_id", organizationId);

    if (!attempt.organization_id) {
      await serviceSupabase
        .from("payment_attempts")
        .update({ organization_id: organizationId, updated_at: new Date().toISOString() })
        .eq("id", attempt.id);
    }

    return respond({ status, stripeSubscriptionId: subscriptionId, stripeCustomerId: customerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile subscription";
    return respond({ error: message }, 400);
  }
}
