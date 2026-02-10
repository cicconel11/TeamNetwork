import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";
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
    await requireEnterpriseRole(resolvedEnterpriseId, ["owner", "org_admin"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // Get all organizations for this enterprise to map names
  const { data: orgs } = await serviceSupabase
    .from("organizations")
    .select("id, name")
    .eq("enterprise_id", resolvedEnterpriseId);

  const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) ?? []);

  // Get all invites for this enterprise (both org-specific and enterprise-wide)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invites, error } = await (serviceSupabase as any)
    .from("enterprise_invites")
    .select("*")
    .eq("enterprise_id", resolvedEnterpriseId)
    .order("created_at", { ascending: false }) as { data: EnterpriseInviteRow[] | null; error: Error | null };

  if (error) {
    return respond({ error: error.message }, 400);
  }

  // Count current admins across all enterprise orgs (for admin cap display)
  const { count: adminCount } = await serviceSupabase
    .from("user_organization_roles")
    .select("id, organizations!inner(enterprise_id)", { count: "exact", head: true })
    .eq("organizations.enterprise_id", resolvedEnterpriseId)
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
    await requireEnterpriseRole(resolvedEnterpriseId, ["owner", "org_admin"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  let body;
  try {
    body = await validateJson(req, createInviteSchema);
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
    const { count, error: countError } = await serviceSupabase
      .from("user_organization_roles")
      .select("id, organizations!inner(enterprise_id)", { count: "exact", head: true })
      .eq("organizations.enterprise_id", resolvedEnterpriseId)
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
    const { data: org } = await serviceSupabase
      .from("organizations")
      .select("id, name")
      .eq("id", organizationId)
      .eq("enterprise_id", resolvedEnterpriseId)
      .single();

    if (!org) {
      return respond({ error: "Organization not found in this enterprise" }, 404);
    }
    orgName = org.name;
  }

  // Use the RPC function to create invite
  const { data: invite, error: rpcError } = await supabase.rpc("create_enterprise_invite", {
    p_enterprise_id: resolvedEnterpriseId,
    p_organization_id: organizationId ?? null,
    p_role: role,
    p_uses: usesRemaining ?? null,
    p_expires_at: expiresAt ?? null,
  });

  if (rpcError) {
    return respond({ error: rpcError.message }, 400);
  }

  logEnterpriseAuditAction({
    actorUserId: user.id,
    actorEmail: user.email ?? "",
    action: "create_invite",
    enterpriseId: resolvedEnterpriseId,
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
