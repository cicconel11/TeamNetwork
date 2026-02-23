import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_BILLING_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise billing portal",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_BILLING_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription, error: subError } = await (ctx.serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("enterprise_id", ctx.enterpriseId)
    .maybeSingle() as { data: { stripe_customer_id: string | null; stripe_subscription_id: string | null } | null; error: Error | null };

  if (subError) {
    console.error("[billing/portal] DB error fetching subscription:", subError);
    return respond({ error: "Internal server error" }, 500);
  }

  let stripeCustomerId = subscription?.stripe_customer_id ?? null;
  if (!stripeCustomerId && subscription?.stripe_subscription_id) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      stripeCustomerId =
        typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer?.id || null;

      if (stripeCustomerId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (ctx.serviceSupabase as any)
          .from("enterprise_subscriptions")
          .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
          .eq("enterprise_id", ctx.enterpriseId);
      }
    } catch (error) {
      console.error("[enterprise-billing-portal] Failed to retrieve Stripe customer", error);
    }
  }

  if (!stripeCustomerId) {
    return respond({ error: "Enterprise billing is not linked to Stripe yet." }, 400);
  }

  // Look up enterprise slug for the return URL
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise } = await (ctx.serviceSupabase as any)
    .from("enterprises")
    .select("slug")
    .eq("id", ctx.enterpriseId)
    .maybeSingle() as { data: { slug: string } | null };

  const enterpriseSlug = enterprise?.slug ?? null;

  if (!enterpriseSlug) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  let session: { url: string };
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/enterprise/${enterpriseSlug}/billing`,
    });
  } catch (err) {
    console.error("[billing/portal] Stripe portal session creation failed:", err);
    return respond({ error: "Failed to open billing portal. Please try again or contact support." }, 500);
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "open_billing_portal",
    enterpriseId: ctx.enterpriseId,
    targetType: "billing",
    targetId: ctx.enterpriseId,
    ...extractRequestContext(req),
  });

  return respond({ url: session.url });
}
