import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ORG_NAV_ITEMS } from "@/lib/navigation/nav-items";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { OrgRole } from "@/lib/auth/role-utils";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

const ALLOWED_ROLES = ["admin", "active_member", "alumni"] as const;
const navEntrySchema = z
  .object({
    label: optionalSafeString(80),
    hidden: z.boolean().optional(),
    hiddenForRoles: z.array(z.enum(ALLOWED_ROLES)).optional(),
    editRoles: z.array(z.enum(ALLOWED_ROLES)).optional(),
    order: z.number().int().min(0).max(100).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    navConfig: z.record(z.string(), navEntrySchema).optional(),
    nav_config: z.record(z.string(), navEntrySchema).optional(),
    name: z.string().max(100).optional(),
  })
  .strict();
const ALLOWED_NAV_PATHS = new Set(ORG_NAV_ITEMS.map((item) => item.href));

function sanitizeNavConfig(payload: unknown): NavConfig {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const config: NavConfig = {};
  for (const [href, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!href || !ALLOWED_NAV_PATHS.has(href) || typeof value !== "object" || value === null || Array.isArray(value)) continue;

    const entry = value as { label?: unknown; hidden?: unknown; hiddenForRoles?: unknown; editRoles?: unknown; order?: unknown };
    const clean: { label?: string; hidden?: boolean; hiddenForRoles?: OrgRole[]; editRoles?: OrgRole[]; order?: number } = {};

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
    if (typeof entry.order === "number" && Number.isInteger(entry.order) && entry.order >= 0) {
      clean.order = entry.order;
    }

    if (Object.keys(clean).length > 0) {
      config[href] = clean;
    }
  }

  return config;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const { organizationId } = await params;
    const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
    if (!orgIdParsed.success) {
      return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
    }

    const parsedBody = await validateJson(req, patchSchema);
    const navConfigInput = parsedBody.navConfig ?? parsedBody.nav_config ?? {};
    const navConfig = sanitizeNavConfig(navConfigInput);
    const nameInput = parsedBody.name;

    // Validate name if provided
    let sanitizedName: string | undefined;
    if (nameInput !== undefined) {
      const trimmedName = nameInput.trim();
      if (!trimmedName) {
        return NextResponse.json({ error: "Organization name cannot be empty" }, { status: 400 });
      }
      if (trimmedName.length > 100) {
        return NextResponse.json({ error: "Organization name must be under 100 characters" }, { status: 400 });
      }
      sanitizedName = trimmedName;
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "organization settings",
      limitPerIp: 40,
      limitPerUser: 25,
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

    // Block mutations if org is in grace period (read-only mode)
    const { isReadOnly } = await checkOrgReadOnly(organizationId);
    if (isReadOnly) {
      return respond(readOnlyResponse(), 403);
    }

    const serviceSupabase = createServiceClient();

    // Build update payload - only include fields that were provided
    const updatePayload: { nav_config?: NavConfig; name?: string } = {};

    // Only update nav_config if navConfig or nav_config was provided in the request
    if (parsedBody.navConfig !== undefined || parsedBody.nav_config !== undefined) {
      updatePayload.nav_config = navConfig;
    }

    // Only update name if it was provided
    if (sanitizedName !== undefined) {
      updatePayload.name = sanitizedName;
    }

    // If nothing to update, return early
    if (Object.keys(updatePayload).length === 0) {
      return respond({ error: "No valid fields to update" }, 400);
    }

    const { data: updatedOrg, error: updateError } = await serviceSupabase
      .from("organizations")
      .update(updatePayload)
      .eq("id", organizationId)
      .select("id, name, nav_config")
      .maybeSingle();

    if (updateError) {
      return respond({ error: updateError.message }, 400);
    }

    if (!updatedOrg) {
      return respond({ error: "Organization not found" }, 404);
    }

    // Return response with updated fields
    const response: { navConfig?: NavConfig; name?: string } = {};
    if (updatePayload.nav_config !== undefined) {
      response.navConfig = navConfig;
    }
    if (sanitizedName !== undefined) {
      response.name = updatedOrg.name;
    }

    return respond(response);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(_req, {
    userId: user?.id ?? null,
    feature: "organization deletion",
    limitPerIp: 10,
    limitPerUser: 5,
    windowMs: 60_000 * 5,
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

    return respond({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete organization";
    return respond({ error: message }, 400);
  }
}
