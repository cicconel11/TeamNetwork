import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ORG_NAV_ITEMS } from "@/lib/navigation/nav-items";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { OrgRole } from "@/lib/auth/role-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const ALLOWED_ROLES: OrgRole[] = ["admin", "active_member", "alumni"];
const ALLOWED_NAV_PATHS = new Set(ORG_NAV_ITEMS.map((item) => item.href));

function sanitizeNavConfig(payload: unknown): NavConfig {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const config: NavConfig = {};
  for (const [href, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!href || !ALLOWED_NAV_PATHS.has(href) || typeof value !== "object" || value === null || Array.isArray(value)) continue;

    const entry = value as { label?: unknown; hidden?: unknown; hiddenForRoles?: unknown; editRoles?: unknown };
    const clean: { label?: string; hidden?: boolean; hiddenForRoles?: OrgRole[]; editRoles?: OrgRole[] } = {};

    if (typeof entry.label === "string" && entry.label.trim()) {
      clean.label = entry.label.trim();
    }
    if (entry.hidden === true) {
      clean.hidden = true;
    }
    if (Array.isArray(entry.hiddenForRoles)) {
      const roles = entry.hiddenForRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
      if (roles.length) {
        clean.hiddenForRoles = Array.from(new Set(roles));
      }
    }
    if (Array.isArray(entry.editRoles)) {
      const roles = entry.editRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
      if (roles.length) {
        clean.editRoles = Array.from(new Set([...roles, "admin"] as OrgRole[]));
      }
    }

    if (Object.keys(clean).length > 0) {
      config[href] = clean;
    }
  }

  return config;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const navConfig = sanitizeNavConfig((body as Record<string, unknown>)?.navConfig ?? (body as Record<string, unknown>)?.nav_config);

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
  const { data: updatedOrg, error: updateError } = await serviceSupabase
    .from("organizations")
    .update({ nav_config: navConfig })
    .eq("id", organizationId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  if (!updatedOrg) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  return NextResponse.json({ navConfig });
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any).from(table).delete().eq("organization_id", organizationId);
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
