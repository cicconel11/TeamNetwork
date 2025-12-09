import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(_req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Require admin role in the organization
  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const serviceSupabase = createServiceClient();

  const { data: subscription } = await serviceSupabase
    .from("organization_subscriptions")
    .select("stripe_subscription_id, status")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const sub = subscription as { stripe_subscription_id: string | null; status?: string | null } | null;

  if (!sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  try {
    if (sub.stripe_subscription_id) {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    }

    await serviceSupabase
      .from("organization_subscriptions")
      .update({
        status: "canceled",
        stripe_subscription_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);

    return NextResponse.json({ status: "canceled" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cancel subscription";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


