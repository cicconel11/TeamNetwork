import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bulkInvitesSchema = z.object({
  invites: z
    .array(z.unknown())
    .min(1, "At least one invite is required")
    .max(100, "Maximum 100 invites per batch"),
});

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise bulk invite",
    limitPerIp: 10,
    limitPerUser: 5,
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
    body = await validateJson(req, bulkInvitesSchema);
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { invites } = body;

  // Get all organizations for this enterprise
  const { data: orgs } = await serviceSupabase
    .from("organizations")
    .select("id")
    .eq("enterprise_id", resolvedEnterpriseId)
    .is("deleted_at", null);

  const validOrgIds = new Set(orgs?.map((o) => o.id) ?? []);

  let success = 0;
  let failed = 0;

  // Process invites one by one using the RPC function
  for (const invite of invites) {
    const inviteObject = typeof invite === "object" && invite !== null
      ? (invite as Record<string, unknown>)
      : null;
    const organizationId = inviteObject?.organizationId;
    const role = inviteObject?.role;

    // Validate
    if (typeof organizationId !== "string" || !baseSchemas.uuid.safeParse(organizationId).success) {
      failed++;
      continue;
    }

    if (!validOrgIds.has(organizationId)) {
      failed++;
      continue;
    }

    if (typeof role !== "string" || !["admin", "active_member", "alumni"].includes(role)) {
      failed++;
      continue;
    }

    try {
      const { error: rpcError } = await supabase.rpc("create_enterprise_invite", {
        p_enterprise_id: resolvedEnterpriseId,
        p_organization_id: organizationId,
        p_role: role,
        p_uses: null,
        p_expires_at: null,
      });

      if (rpcError) {
        failed++;
      } else {
        success++;
      }
    } catch {
      failed++;
    }
  }

  return respond({ success, failed, total: invites.length });
}
