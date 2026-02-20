import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

const createInviteSchema = z.object({
  organizationId: baseSchemas.uuid.optional(),
  role: z.enum(["admin", "active_member", "alumni"]),
  usesRemaining: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for enterprise invite row (until types are regenerated)
interface EnterpriseInviteRow {
  id: string;
  organization_id: string | null;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string | null;
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
  const { data: orgs } = await ctx.serviceSupabase
    .from("organizations")
    .select("id, name")
    .eq("enterprise_id", ctx.enterpriseId);

  const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) ?? []);

  // Get all invites for this enterprise (both org-specific and enterprise-wide)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invites, error } = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .select("*")
    .eq("enterprise_id", ctx.enterpriseId)
    .order("created_at", { ascending: false }) as { data: EnterpriseInviteRow[] | null; error: Error | null };

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

  // Add organization names (null org_id = enterprise-wide)
  const invitesWithOrg = (invites ?? []).map((invite: EnterpriseInviteRow) => ({
    ...invite,
    organization_name: invite.organization_id
      ? (orgMap.get(invite.organization_id) ?? "Unknown")
      : null,
    is_enterprise_wide: invite.organization_id === null,
  }));

  return respond({ invites: invitesWithOrg, adminCount: adminCount ?? 0, adminLimit: 12 });
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

  // Enterprise-wide invites cannot use active_member role
  if (!organizationId && role === "active_member") {
    return respond(
      { error: "Enterprise-wide invites require a specific role (admin or alumni). Members must join a specific organization." },
      400
    );
  }

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

  // Use the RPC function to create invite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: rpcError } = await (ctx.serviceSupabase as any).rpc("create_enterprise_invite", {
    p_enterprise_id: ctx.enterpriseId,
    p_organization_id: organizationId ?? null,
    p_role: role,
    p_uses: usesRemaining ?? null,
    p_expires_at: expiresAt ?? null,
  });

  if (rpcError) {
    console.error("[enterprise/invites POST] RPC error:", rpcError);
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
