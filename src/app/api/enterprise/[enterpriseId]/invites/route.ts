import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { decodeCursor, applyCursorFilter, buildCursorResponse } from "@/lib/pagination/cursor";

const createInviteSchema = z.object({
  organizationId: baseSchemas.uuid.optional(),
  role: z.enum(["admin", "active_member", "alumni"]),
  usesRemaining: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
}).refine(
  (data) => data.organizationId || data.role !== "active_member",
  {
    message: "Enterprise-wide invites require a specific role (admin or alumni). Members must join a specific organization.",
    path: ["role"],
  }
);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for enterprise invite row (until types are regenerated)
interface EnterpriseInviteRow {
  id: string;
  organization_id: string | null;
  role: string;
  created_at: string;
  expires_at: string | null;
  code?: string;
  token?: string;
  uses_remaining?: number | null;
  revoked_at?: string | null;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise invites",
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

  // Get all organizations for this enterprise to map names
  const { data: orgs, error: orgsError } = await ctx.serviceSupabase
    .from("organizations")
    .select("id, name")
    .eq("enterprise_id", ctx.enterpriseId);

  if (orgsError) {
    console.error("[enterprise/invites GET] Failed to fetch organizations:", orgsError);
    return respond({ error: "Failed to fetch organizations" }, 500);
  }

  const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) ?? []);

  // Parse pagination params
  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam || "25", 10) || 25, 1), 100);

  const decoded = cursorParam ? decodeCursor(cursorParam) : null;
  if (cursorParam && !decoded) {
    return respond({ error: "Invalid cursor" }, 400);
  }

  // Get paginated invites for this enterprise. Token is included (admin-only endpoint);
  // avoid logging the full invites array, log IDs only. Exclude revoked invites by default.
  const includeRevoked = url.searchParams.get("include_revoked") === "true";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inviteQuery = (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .select("id, organization_id, role, created_at, expires_at, code, token, uses_remaining, revoked_at")
    .eq("enterprise_id", ctx.enterpriseId);

  if (!includeRevoked) {
    inviteQuery = inviteQuery.is("revoked_at", null);
  }

  inviteQuery = inviteQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (decoded) {
    inviteQuery = applyCursorFilter(inviteQuery, decoded);
  }

  const { data: invites, error } = await inviteQuery as { data: EnterpriseInviteRow[] | null; error: Error | null };

  if (error) {
    console.error("[enterprise/invites GET] DB error:", error);
    return respond({ error: "Failed to fetch invites" }, 500);
  }

  // Count current admins across all enterprise orgs (for admin cap display)
  const { count: adminCount } = await ctx.serviceSupabase
    .from("user_organization_roles")
    .select("id, organizations!inner(enterprise_id)", { count: "exact", head: true })
    .eq("organizations.enterprise_id", ctx.enterpriseId)
    .eq("role", "admin")
    .eq("status", "active");

  // Paginate and add organization names
  const paginatedResult = buildCursorResponse(invites ?? [], limit);
  const invitesWithOrg = paginatedResult.data.map((invite: EnterpriseInviteRow) => ({
    ...invite,
    organization_name: invite.organization_id
      ? (orgMap.get(invite.organization_id) ?? "Unknown")
      : null,
    is_enterprise_wide: invite.organization_id === null,
  }));

  // Total count for stats (separate HEAD query)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: totalInvites } = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .select("*", { count: "exact", head: true })
    .eq("enterprise_id", ctx.enterpriseId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: activeInvites } = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .select("*", { count: "exact", head: true })
    .eq("enterprise_id", ctx.enterpriseId)
    .is("revoked_at", null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: enterpriseWideCount } = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .select("*", { count: "exact", head: true })
    .eq("enterprise_id", ctx.enterpriseId)
    .is("organization_id", null);

  return respond({
    invites: invitesWithOrg,
    nextCursor: paginatedResult.nextCursor,
    hasMore: paginatedResult.hasMore,
    stats: {
      total: totalInvites ?? 0,
      active: activeInvites ?? 0,
      enterpriseWide: enterpriseWideCount ?? 0,
    },
    adminCount: adminCount ?? 0,
    adminLimit: 12,
  });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise invite create",
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
    body = await validateJson(req, createInviteSchema, { maxBodyBytes: 8_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { organizationId, role, usesRemaining, expiresAt } = body;

  // Pre-check enterprise admin cap (12 max across all orgs)
  if (role === "admin") {
    const { count, error: countError } = await ctx.serviceSupabase
      .from("user_organization_roles")
      .select("id, organizations!inner(enterprise_id)", { count: "exact", head: true })
      .eq("organizations.enterprise_id", ctx.enterpriseId)
      .eq("role", "admin")
      .eq("status", "active");

    if (countError) {
      // Fallback: let the RPC enforce the cap if the pre-check fails
    } else if ((count ?? 0) >= 12) {
      return respond(
        { error: "Enterprise admin limit reached (maximum 12 admins across all organizations)" },
        400
      );
    }
  }

  let orgName: string | null = null;

  // If org-specific invite, verify organization belongs to this enterprise
  if (organizationId) {
    const { data: org } = await ctx.serviceSupabase
      .from("organizations")
      .select("id, name")
      .eq("id", organizationId)
      .eq("enterprise_id", ctx.enterpriseId)
      .single();

    if (!org) {
      return respond({ error: "Organization not found in this enterprise" }, 404);
    }
    orgName = org.name;
  }

  // Use the RPC function to create invite (user-authenticated client so auth.uid() works)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: rpcError } = await (supabase as any).rpc("create_enterprise_invite", {
    p_enterprise_id: ctx.enterpriseId,
    p_organization_id: organizationId ?? null,
    p_role: role,
    p_uses: usesRemaining ?? null,
    p_expires_at: expiresAt ?? null,
  });

  if (rpcError) {
    console.error("[enterprise/invites POST] RPC error:", rpcError);
    return respond({ error: rpcError.message || "Failed to create invite" }, 400);
  }

  if (!invite || typeof invite.id !== "string") {
    console.error("[enterprise/invites POST] RPC returned null or invalid invite", {
      enterpriseId: ctx.enterpriseId,
    });
    return respond({ error: "Failed to create invite" }, 500);
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "create_invite",
    enterpriseId: ctx.enterpriseId,
    organizationId: organizationId ?? undefined,
    targetType: "invite",
    metadata: { role, isEnterpriseWide: !organizationId },
    ...extractRequestContext(req),
  });

  return respond({
    ...invite,
    organization_name: orgName,
    is_enterprise_wide: !organizationId,
  });
}
