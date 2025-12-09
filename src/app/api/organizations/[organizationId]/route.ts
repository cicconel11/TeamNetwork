import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function DELETE(_req: Request, { params }: RouteParams) {
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

  // Fetch subscription to cancel on Stripe, if any
  const { data: subscription } = await serviceSupabase
    .from("organization_subscriptions")
    .select("stripe_subscription_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const sub = subscription as { stripe_subscription_id: string | null } | null;

  try {
    if (sub?.stripe_subscription_id) {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    }

    // Delete related records (best-effort order to satisfy FKs)
    const deletionOrder = [
      "competition_points",
      "competitions",
      "members",
      "alumni",
      "events",
      "announcements",
      "donations",
      "records",
      "philanthropy_events",
      "notifications",
      "notification_preferences",
      "organization_invites",
      "user_organization_roles",
      "organization_subscriptions",
    ];

    for (const table of deletionOrder) {
      await serviceSupabase.from(table).delete().eq("organization_id", organizationId);
    }

    // Finally delete the organization
    const { error: orgDeleteError } = await serviceSupabase
      .from("organizations")
      .delete()
      .eq("id", organizationId);

    if (orgDeleteError) {
      throw new Error(orgDeleteError.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete organization";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}


