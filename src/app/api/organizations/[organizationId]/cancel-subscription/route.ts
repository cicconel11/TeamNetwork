import { NextResponse } from "next/server";
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

export async function POST(_req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(_req, {
    userId: user?.id ?? null,
    feature: "subscription cancellation",
    limitPerIp: 20,
    limitPerUser: 10,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  // Require admin role in the organization
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
  type OrgSubTable = Database["public"]["Tables"]["organization_subscriptions"];
  type OrgSubUpdate = OrgSubTable["Update"];

  const { data: subscription } = await serviceSupabase
    .from("organization_subscriptions")
    .select("stripe_subscription_id, status, current_period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const sub = subscription as { 
    stripe_subscription_id: string | null; 
    status?: string | null;
    current_period_end?: string | null;
  } | null;

  if (!sub) {
    return respond({ error: "Subscription not found" }, 404);
  }

  try {
    let currentPeriodEnd = sub.current_period_end;

    if (sub.stripe_subscription_id) {
      // Schedule cancellation at period end instead of immediate cancel
      const updatedSub = await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      
      // Get the period end from the first subscription item
      const firstItem = updatedSub.items?.data?.[0];
      if (firstItem?.current_period_end) {
        currentPeriodEnd = new Date(firstItem.current_period_end * 1000).toISOString();
      }
    }

    // Update status to "canceling" to indicate scheduled cancellation
    const payload: OrgSubUpdate = {
      status: "canceling",
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    const table = "organization_subscriptions" as const;
    await serviceSupabase.from(table).update(payload).eq("organization_id", organizationId);

    return respond({ 
      status: "canceling",
      currentPeriodEnd,
      message: "Subscription will be cancelled at the end of the billing period",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cancel subscription";
    return respond({ error: message }, 400);
  }
}

