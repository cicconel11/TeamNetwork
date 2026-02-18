import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise navigation sync",
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

  // Get all organizations for this enterprise
  const { data: orgs, error: orgsError } = await ctx.serviceSupabase
    .from("organizations")
    .select("id")
    .eq("enterprise_id", ctx.enterpriseId);

  if (orgsError || !orgs) {
    return respond({ error: "Failed to fetch organizations" }, 400);
  }

  if (orgs.length === 0) {
    return respond({ success: true, synced: 0, message: "No organizations to sync" });
  }

  // Sync all organizations in parallel
  const results = await Promise.allSettled(
    orgs.map((org) =>
      supabase.rpc("sync_enterprise_nav_to_org", {
        p_enterprise_id: ctx.enterpriseId,
        p_organization_id: org.id,
      })
    )
  );

  let synced = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "fulfilled" && !result.value.error && result.value.data) {
      synced++;
    } else {
      failed++;
    }
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "sync_navigation",
    enterpriseId: ctx.enterpriseId,
    targetType: "enterprise",
    targetId: ctx.enterpriseId,
    metadata: { synced, failed, total: orgs.length },
    ...extractRequestContext(req),
  });

  return respond({
    success: true,
    synced,
    failed,
    total: orgs.length,
    message: `Synced ${synced} of ${orgs.length} organizations`,
  });
}
