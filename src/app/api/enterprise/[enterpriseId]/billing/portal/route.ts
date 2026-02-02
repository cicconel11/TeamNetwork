import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe } from "@/lib/stripe";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { requireEnterpriseBillingAccess } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

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
    await requireEnterpriseBillingAccess(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription, error: subError } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("enterprise_id", resolvedEnterpriseId)
    .maybeSingle() as { data: { stripe_customer_id: string | null; stripe_subscription_id: string | null } | null; error: Error | null };

  if (subError) {
    return respond({ error: subError.message }, 400);
  }

  let stripeCustomerId = subscription?.stripe_customer_id ?? null;
  if (!stripeCustomerId && subscription?.stripe_subscription_id) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      stripeCustomerId =
        typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer?.id || null;

      if (stripeCustomerId) {
        await serviceSupabase
          .from("enterprise_subscriptions")
          .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
          .eq("enterprise_id", resolvedEnterpriseId);
      }
    } catch (error) {
      console.error("[enterprise-billing-portal] Failed to retrieve Stripe customer", error);
    }
  }

  if (!stripeCustomerId) {
    return respond({ error: "Enterprise billing is not linked to Stripe yet." }, 400);
  }

  let enterpriseSlug = resolved?.enterpriseSlug;
  if (!enterpriseSlug) {
    const { data: enterprise } = await serviceSupabase
      .from("enterprises")
      .select("slug")
      .eq("id", resolvedEnterpriseId)
      .maybeSingle();
    enterpriseSlug = enterprise?.slug ?? null;
  }

  if (!enterpriseSlug) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${origin}/enterprise/${enterpriseSlug}/billing`,
  });

  return respond({ url: session.url });
}
