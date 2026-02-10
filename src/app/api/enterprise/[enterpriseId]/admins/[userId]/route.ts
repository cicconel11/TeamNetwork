import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { requireEnterpriseOwner } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    await requireEnterpriseOwner(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: targetRole } = await (serviceSupabase as any)
    .from("user_enterprise_roles")
    .select("id, role")
    .eq("enterprise_id", resolvedEnterpriseId)
    .eq("user_id", userId)
    .single() as { data: UserEnterpriseRoleRow | null };

  if (!targetRole) {
    return respond({ error: "User is not an admin of this enterprise" }, 404);
  }

  if (targetRole.role === "owner") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: ownerCount } = await (serviceSupabase as any)
      .from("user_enterprise_roles")
      .select("*", { count: "exact", head: true })
      .eq("enterprise_id", resolvedEnterpriseId)
      .eq("role", "owner") as { count: number | null };

    if ((ownerCount ?? 0) <= 1) {
      return respond({ error: "Cannot remove the last owner. Transfer ownership first." }, 400);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteError } = await (serviceSupabase as any)
    .from("user_enterprise_roles")
    .delete()
    .eq("id", targetRole.id);

  if (deleteError) {
    return respond({ error: deleteError.message }, 400);
  }

  logEnterpriseAuditAction({
    actorUserId: user.id,
    actorEmail: user.email ?? "",
    action: "remove_admin",
    enterpriseId: resolvedEnterpriseId,
    targetType: "user",
    targetId: userId,
    metadata: { removedRole: targetRole.role },
    ...extractRequestContext(req),
  });

  return respond({ success: true });
}
