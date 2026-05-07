import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

const navConfigItemSchema = z.object({
  hidden: z.boolean().optional(),
  hiddenForRoles: z.array(z.enum(["admin", "active_member", "alumni"])).max(10).optional(),
  label: z.string().max(100).optional(),
});

const navigationPatchSchema = z
  .object({
    navConfig: z.record(z.string().max(100), navConfigItemSchema).optional(),
    lockedItems: z.array(z.string().max(100)).max(50).optional(),
  })
  .refine((data) => data.navConfig !== undefined || data.lockedItems !== undefined, {
    message: "No update data provided",
  });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise navigation",
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Get enterprise nav config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise, error: enterpriseError } = await (ctx.serviceSupabase as any)
    .from("enterprises")
    .select("nav_config, nav_locked_items")
    .eq("id", ctx.enterpriseId)
    .single() as { data: { nav_config: unknown; nav_locked_items: string[] | null } | null; error: Error | null };

  if (enterpriseError || !enterprise) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  // Get organizations with sync status
  const { data: orgs } = await ctx.serviceSupabase
    .from("organizations")
    .select("id, name, slug, enterprise_nav_synced_at")
    .eq("enterprise_id", ctx.enterpriseId)
    .order("name");

  return respond({
    navConfig: enterprise.nav_config || {},
    lockedItems: enterprise.nav_locked_items || [],
    organizations: orgs || [],
  });
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise navigation update",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  let body;
  try {
    body = await validateJson(req, navigationPatchSchema);
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { navConfig, lockedItems } = body;

  // Build update object
  const update: Record<string, unknown> = {};
  if (navConfig !== undefined) {
    update.nav_config = navConfig;
  }
  if (lockedItems !== undefined) {
    update.nav_locked_items = lockedItems;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (ctx.serviceSupabase as any)
    .from("enterprises")
    .update(update)
    .eq("id", ctx.enterpriseId);

  if (updateError) {
    console.error("[enterprise/navigation PATCH] DB error:", updateError);
    return respond({ error: "Internal server error" }, 500);
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "update_navigation",
    enterpriseId: ctx.enterpriseId,
    targetType: "enterprise",
    targetId: ctx.enterpriseId,
    metadata: { hasNavConfig: navConfig !== undefined, hasLockedItems: lockedItems !== undefined },
    ...extractRequestContext(req),
  });

  return respond({ success: true, message: "Navigation settings updated" });
}
