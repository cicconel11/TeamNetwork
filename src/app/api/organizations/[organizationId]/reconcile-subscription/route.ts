import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  canDevAdminPerform,
  logDevAdminAction,
  extractRequestContext,
} from "@/lib/auth/dev-admin";
import type { Database } from "@/types/database";
import {
  pickMostRecentRecoverableAttempt,
  resolveRecoverableAttemptLookup,
  type RecoverableAttempt,
} from "@/lib/payments/reconcile-helpers";

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

  const { createClient } = await import("@/lib/supabase/server");
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { stripe } = await import("@/lib/stripe");
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

  const isDevAdminAllowed = canDevAdminPerform(user, "reconcile_subscription");
  if (role?.role !== "admin" && !isDevAdminAllowed) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Log dev-admin action after auth check
  if (isDevAdminAllowed) {
    logDevAdminAction({
      adminUserId: user.id,
      adminEmail: user.email ?? "",
      action: "reconcile_subscription",
      targetType: "subscription",
      targetId: organizationId,
      ...extractRequestContext(req),
    });
  }

  const serviceSupabase = createServiceClient();

  const { data: subscriptionRow } = await serviceSupabase
    .from("organization_subscriptions")
    .select("status, stripe_subscription_id, stripe_customer_id, current_period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!subscriptionRow) {
    return respond({ error: "Subscription not found" }, 404);
  }

  // Only skip reconciliation if:
  // - Stripe IDs exist
  // - Status is already valid
  // - AND current_period_end is populated (not null)
  // If current_period_end is null, we need to fetch from Stripe to backfill it
  const validStatuses = ["active", "trialing", "canceling", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired"];
  const hasValidStatus = validStatuses.includes(subscriptionRow.status || "");
  const hasCurrentPeriodEnd = subscriptionRow.current_period_end !== null;
  
  if (
    subscriptionRow.stripe_subscription_id && 
    subscriptionRow.stripe_customer_id &&
    hasValidStatus &&
    hasCurrentPeriodEnd
  ) {
    return respond({ status: subscriptionRow.status || "active" });
  }

  // If we have Stripe IDs but invalid status, fetch directly from Stripe to reconcile
  if (subscriptionRow.stripe_subscription_id) {
    try {
      const subscription = (await stripe.subscriptions.retrieve(subscriptionRow.stripe_subscription_id)) as SubscriptionWithPeriod;
      const customerId = typeof subscription.customer === "string"
        ? subscription.customer
        : (subscription.customer as { id?: string })?.id || subscriptionRow.stripe_customer_id;
      const currentPeriodEnd = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;
      const status = normalizeSubscriptionStatus({
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
      });

      const payload: Database["public"]["Tables"]["organization_subscriptions"]["Update"] = {
        stripe_subscription_id: subscriptionRow.stripe_subscription_id,
        stripe_customer_id: customerId,
        status,
        current_period_end: currentPeriodEnd,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await serviceSupabase
        .from("organization_subscriptions")
        .update(payload)
        .eq("organization_id", organizationId);
      if (updateError) {
        console.error("[reconcile-subscription] Failed to persist reconciled subscription", {
          organizationId,
          code: updateError.code,
          message: updateError.message,
        });
        return respond({ error: "Unable to persist reconciled subscription state" }, 500);
      }

      return respond({ status, stripeSubscriptionId: subscriptionRow.stripe_subscription_id, stripeCustomerId: customerId });
    } catch (error) {
      console.error("[reconcile-subscription] Failed to fetch subscription from Stripe:", error);
      // Fall through to payment_attempts lookup
    }
  }

  // Search payment_attempts with any status that indicates a checkout happened
  // This includes both payment-lifecycle statuses (succeeded, processing) and 
  // subscription statuses (active, trialing, etc.) since webhook may store either
  const recoverableStatuses = [
    // Payment lifecycle statuses (legacy)
    "succeeded", "processing",
    // Subscription statuses (webhook may store these now)
    "active", "trialing", "canceling", "past_due", "unpaid", "canceled",
    "incomplete", "incomplete_expired",
    // Also check "complete" which can be stored from checkout session
    "complete", "completed",
  ];
  
  const [byOrgId, byPendingOrgId] = await Promise.all([
    serviceSupabase
      .from("payment_attempts")
      .select("id, stripe_checkout_session_id, status, organization_id, metadata, created_at")
      .eq("organization_id", organizationId)
      .in("status", recoverableStatuses)
      .order("created_at", { ascending: false })
      .limit(1),
    serviceSupabase
      .from("payment_attempts")
      .select("id, stripe_checkout_session_id, status, organization_id, metadata, created_at")
      .eq("metadata->>pending_org_id", organizationId)
      .in("status", recoverableStatuses)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const lookup = resolveRecoverableAttemptLookup({
    byOrgId: {
      data: byOrgId.data as RecoverableAttempt[] | null,
      error: byOrgId.error ? { code: byOrgId.error.code, message: byOrgId.error.message } : null,
    },
    byPendingOrgId: {
      data: byPendingOrgId.data as RecoverableAttempt[] | null,
      error: byPendingOrgId.error
        ? { code: byPendingOrgId.error.code, message: byPendingOrgId.error.message }
        : null,
    },
  });

  if (lookup.error) {
    console.error("[reconcile-subscription] Failed payment_attempts lookup", {
      organizationId,
      byOrgIdError: byOrgId.error ? { code: byOrgId.error.code, message: byOrgId.error.message } : null,
      byPendingOrgIdError: byPendingOrgId.error
        ? { code: byPendingOrgId.error.code, message: byPendingOrgId.error.message }
        : null,
    });
    return respond({ error: lookup.error }, 500);
  }

  const attempt = lookup.attempt;
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

    const { error: updateError } = await serviceSupabase
      .from("organization_subscriptions")
      .update(payload)
      .eq("organization_id", organizationId);
    if (updateError) {
      console.error("[reconcile-subscription] Failed to persist recovered subscription", {
        organizationId,
        code: updateError.code,
        message: updateError.message,
      });
      return respond({ error: "Unable to persist reconciled subscription state" }, 500);
    }

    if (!attempt.organization_id) {
      const { error: attemptUpdateError } = await serviceSupabase
        .from("payment_attempts")
        .update({ organization_id: organizationId, updated_at: new Date().toISOString() })
        .eq("id", attempt.id);
      if (attemptUpdateError) {
        console.error("[reconcile-subscription] Failed to update payment attempt organization_id", {
          attemptId: attempt.id,
          organizationId,
          code: attemptUpdateError.code,
          message: attemptUpdateError.message,
        });
      }
    }

    return respond({ status, stripeSubscriptionId: subscriptionId, stripeCustomerId: customerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile subscription";
    return respond({ error: message }, 400);
  }
}
