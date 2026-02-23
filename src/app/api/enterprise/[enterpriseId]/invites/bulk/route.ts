import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

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

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  let body;
  try {
    body = await validateJson(req, bulkInvitesSchema, { maxBodyBytes: 16_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const { invites } = body;

  // Get all organizations for this enterprise
  const { data: orgs } = await ctx.serviceSupabase
    .from("organizations")
    .select("id")
    .eq("enterprise_id", ctx.enterpriseId);

  const validOrgIds = new Set(orgs?.map((o) => o.id) ?? []);

  const validInvites = invites.filter((i) => validOrgIds.has(i.organizationId));
  const invalidCount = invites.length - validInvites.length;

  // Process all valid invites in parallel
  const results = await Promise.allSettled(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validInvites.map((invite) =>
      (ctx.serviceSupabase as any).rpc("create_enterprise_invite", {
        p_enterprise_id: ctx.enterpriseId,
        p_organization_id: invite.organizationId,
        p_role: invite.role,
        p_uses: null,
        p_expires_at: null,
      })
    )
  );

  const success = results.filter((r) => r.status === "fulfilled" && !r.value.error).length;
  const failed = invalidCount + (validInvites.length - success);

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "bulk_invite",
    enterpriseId: ctx.enterpriseId,
    targetType: "invite",
    metadata: { success, failed, total: invites.length },
    ...extractRequestContext(req),
  });

  return respond({ success, failed, total: invites.length });
}
