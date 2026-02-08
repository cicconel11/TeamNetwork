import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inviteItemSchema = z.object({
  organizationId: z.string().uuid("organizationId must be a valid UUID"),
  role: z.enum(["admin", "active_member", "alumni"], {
    message: "role must be one of: admin, active_member, alumni",
  }),
});

const bulkInvitesSchema = z.object({
  invites: z
    .array(inviteItemSchema)
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
    .eq("enterprise_id", resolvedEnterpriseId);

  const validOrgIds = new Set(orgs?.map((o) => o.id) ?? []);

  let success = 0;
  let failed = 0;

  // Process invites one by one using the RPC function
  for (const invite of invites) {
    if (!validOrgIds.has(invite.organizationId)) {
      failed++;
      continue;
    }

    try {
      const { error: rpcError } = await supabase.rpc("create_enterprise_invite", {
        p_enterprise_id: resolvedEnterpriseId,
        p_organization_id: invite.organizationId,
        p_role: invite.role,
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
