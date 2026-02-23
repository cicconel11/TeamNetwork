import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  getEnterpriseApiContext,
  ENTERPRISE_OWNER_ROLE,
} from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { removeEnterpriseAdmin } from "@/lib/enterprise/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// NOTE: admins/route.ts also has a DELETE handler (body-based: { userId }).
// This [userId] path variant is the one used by SettingsClient.tsx.
// Both delegate to removeEnterpriseAdmin() for owner-count protection.

interface RouteParams {
  params: Promise<{ enterpriseId: string; userId: string }>;
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { enterpriseId, userId } = await params;

  const userIdParsed = baseSchemas.uuid.safeParse(userId);
  if (!userIdParsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "remove enterprise admin",
    limitPerIp: 20,
    limitPerUser: 10,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_OWNER_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  const result = await removeEnterpriseAdmin(ctx.serviceSupabase, ctx.enterpriseId, userId);
  if ("error" in result) {
    return respond({ error: result.error }, result.status);
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "remove_admin",
    enterpriseId: ctx.enterpriseId,
    targetType: "user",
    targetId: userId,
    metadata: { removedRole: result.removedRole },
    ...extractRequestContext(req),
  });

  return respond({ success: true });
}
