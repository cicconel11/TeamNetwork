import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

const createInviteSchema = z.object({
  organizationId: baseSchemas.uuid,
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
  organization_id: string;
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
    .eq("enterprise_id", resolvedEnterpriseId)
    .is("deleted_at", null);

  const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) ?? []);
  const orgIds = orgs?.map((o) => o.id) ?? [];

  if (orgIds.length === 0) {
    return respond({ invites: [] });
  }

  // Get all invites for enterprise organizations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invites, error } = await (serviceSupabase as any)
    .from("enterprise_invites")
    .select("*")
    .eq("enterprise_id", resolvedEnterpriseId)
    .in("organization_id", orgIds)
    .order("created_at", { ascending: false }) as { data: EnterpriseInviteRow[] | null; error: Error | null };

  if (error) {
    return respond({ error: error.message }, 400);
  }

  // Add organization names
  const invitesWithOrg = (invites ?? []).map((invite: EnterpriseInviteRow) => ({
    ...invite,
    organization_name: orgMap.get(invite.organization_id) ?? "Unknown",
  }));

  return respond({ invites: invitesWithOrg });
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

  // Verify organization belongs to this enterprise
  const { data: org } = await serviceSupabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .eq("enterprise_id", resolvedEnterpriseId)
    .single();

  if (!org) {
    return respond({ error: "Organization not found in this enterprise" }, 404);
  }

  // Use the RPC function to create invite
  const { data: invite, error: rpcError } = await supabase.rpc("create_enterprise_invite", {
    p_enterprise_id: resolvedEnterpriseId,
    p_organization_id: organizationId,
    p_role: role,
    p_uses: usesRemaining ?? null,
    p_expires_at: expiresAt ?? null,
  });

  if (rpcError) {
    return respond({ error: rpcError.message }, 400);
  }

  return respond({
    ...invite,
    organization_name: org.name,
  });
}
