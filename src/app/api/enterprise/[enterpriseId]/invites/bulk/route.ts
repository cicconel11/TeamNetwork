/* eslint-disable @typescript-eslint/no-explicit-any */
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

  // Process valid invites in batches of 5 to prevent connection pool exhaustion
  // The advisory lock in the RPC serializes concurrent calls per enterprise anyway,
  // so batching mainly reduces connection pressure from large bulk uploads.
  const CONCURRENCY = 5;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: PromiseSettledResult<any>[] = [];
  for (let i = 0; i < validInvites.length; i += CONCURRENCY) {
    const batch = validInvites.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((invite) =>
        (supabase as any).rpc("create_enterprise_invite", {
          p_enterprise_id: ctx.enterpriseId,
          p_organization_id: invite.organizationId,
          p_role: invite.role,
          p_uses: null,
          p_expires_at: null,
        })
      )
    );
    results.push(...batchResults);
  }

  const perItemResults = validInvites.map((invite, idx) => {
    const result = results[idx];
    if (result.status === "fulfilled" && !result.value.error) {
      return { organizationId: invite.organizationId, role: invite.role, status: "created" as const };
    }
    const errorMsg = result.status === "rejected"
      ? (result.reason instanceof Error ? result.reason.message : "Unknown error")
      : result.value?.error?.message ?? "RPC error";
    return { organizationId: invite.organizationId, role: invite.role, status: "failed" as const, error: errorMsg };
  });

  // Add invalid org entries
  const invalidResults = invites
    .filter((i) => !validOrgIds.has(i.organizationId))
    .map((i) => ({ organizationId: i.organizationId, role: i.role, status: "failed" as const, error: "Organization not found in enterprise" }));

  const allResults = [...perItemResults, ...invalidResults];
  const successCount = allResults.filter((r) => r.status === "created").length;
  const failedCount = allResults.filter((r) => r.status === "failed").length;

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "bulk_invite",
    enterpriseId: ctx.enterpriseId,
    targetType: "invite",
    metadata: { success: successCount, failed: failedCount, total: invites.length },
    ...extractRequestContext(req),
  });

  return respond({
    summary: { success: successCount, failed: failedCount, total: invites.length },
    results: allResults,
  });
}
