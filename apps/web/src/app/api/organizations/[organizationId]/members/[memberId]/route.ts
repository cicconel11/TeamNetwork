import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { requireActiveOrgAdmin } from "@/lib/auth/require-active-admin";
import { executeMemberRoleChange, type MemberRoleChangeClient } from "@/lib/members/role-change";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; memberId: string }>;
}

const patchSchema = z
  .object({
    role: z.enum(["admin", "active_member", "alumni", "parent"]).optional(),
    status: z.enum(["active", "revoked", "pending"]).optional(),
  })
  .refine((d) => d.role !== undefined || d.status !== undefined, {
    message: "At least one of role or status is required",
  });

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, memberId: userId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const userIdParsed = baseSchemas.uuid.safeParse(userId);
  if (!userIdParsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "member role update",
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

  if (!(await requireActiveOrgAdmin(supabase, user.id, organizationId))) {
    return respond({ error: "Forbidden" }, 403);
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = await validateJson(req, patchSchema, { maxBodyBytes: 1_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const serviceSupabase = createServiceClient();

  const result = await executeMemberRoleChange(serviceSupabase as unknown as MemberRoleChangeClient, {
    organizationId,
    actorUserId: user.id,
    targetUserId: userId,
    role: body.role,
    status: body.status,
    source: "manual",
  });

  if (result.state === "invalid") {
    return respond({ error: result.reason }, result.reason === "target_not_found" ? 404 : 400);
  }

  if (result.state === "error") {
    if (result.reason === "actor_not_admin") {
      return respond({ error: "Forbidden" }, 403);
    }
    if (result.reason === "target_not_found") {
      return respond({ error: "target_not_found" }, 404);
    }
    if (result.reason === "stale_member_role") {
      return respond({ error: result.message }, 409);
    }
    if (
      result.reason === "last_admin_self_demotion" ||
      result.reason === "last_admin_target_demotion" ||
      result.reason === "alumni_upgrade_required" ||
      result.reason === "parent_upgrade_required"
    ) {
      return respond({ error: result.message }, 400);
    }
    console.error("[members PATCH] Role change error:", result);
    return respond({ error: "Failed to update member" }, 500);
  }

  // Invalidate router cache so navigating to other pages shows fresh data
  const { data: orgSlugRow } = await serviceSupabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .single();

  if (orgSlugRow?.slug) {
    const slug = orgSlugRow.slug;
    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/members`, "layout");
    revalidatePath(`/${slug}/parents`, "layout");
    revalidatePath(`/${slug}/settings/invites`);
  }

  return respond({ success: true });
}
