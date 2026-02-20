import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  getEnterpriseApiContext,
  ENTERPRISE_OWNER_ROLE,
} from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// NOTE: admins/route.ts also has a DELETE handler (body-based: { userId }).
// This [userId] path variant is the one used by SettingsClient.tsx.
// Both implement identical owner-count protection and audit logging.

interface RouteParams {
  params: Promise<{ enterpriseId: string; userId: string }>;
}

// Type for user_enterprise_roles table row (until types are regenerated)
interface UserEnterpriseRoleRow {
  id: string;
  user_id: string;
  enterprise_id: string;
  role: "owner" | "billing_admin" | "org_admin";
  created_at: string;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: targetRole } = await (ctx.serviceSupabase as any)
    .from("user_enterprise_roles")
    .select("id, role")
    .eq("enterprise_id", ctx.enterpriseId)
    .eq("user_id", userId)
    .single() as { data: UserEnterpriseRoleRow | null };

  if (!targetRole) {
    return respond({ error: "User is not an admin of this enterprise" }, 404);
  }

  if (targetRole.role === "owner") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: ownerCount } = await (ctx.serviceSupabase as any)
      .from("user_enterprise_roles")
      .select("*", { count: "exact", head: true })
      .eq("enterprise_id", ctx.enterpriseId)
      .eq("role", "owner") as { count: number | null };

    if ((ownerCount ?? 0) <= 1) {
      return respond({ error: "Cannot remove the last owner. Transfer ownership first." }, 400);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteError } = await (ctx.serviceSupabase as any)
    .from("user_enterprise_roles")
    .delete()
    .eq("id", targetRole.id);

  if (deleteError) {
    console.error("[enterprise/admins/[userId] DELETE] DB error:", deleteError);
    return respond({ error: "Internal server error" }, 500);
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "remove_admin",
    enterpriseId: ctx.enterpriseId,
    targetType: "user",
    targetId: userId,
    metadata: { removedRole: targetRole.role },
    ...extractRequestContext(req),
  });

  return respond({ success: true });
}
