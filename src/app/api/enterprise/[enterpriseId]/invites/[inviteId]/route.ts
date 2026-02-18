import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";

const invitePatchSchema = z.object({
  revoked: z.literal(true, { message: "revoked must be true" }),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string; inviteId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { enterpriseId, inviteId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise invite update",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Verify invite belongs to this enterprise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite } = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .select("*")
    .eq("id", inviteId)
    .eq("enterprise_id", ctx.enterpriseId)
    .single();

  if (!invite) {
    return respond({ error: "Invite not found" }, 404);
  }

  let body;
  try {
    body = await validateJson(req, invitePatchSchema);
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  if (body.revoked === true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (ctx.serviceSupabase as any)
      .from("enterprise_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId);

    if (updateError) {
      return respond({ error: updateError.message }, 400);
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "revoke_invite",
      enterpriseId: ctx.enterpriseId,
      targetType: "invite",
      targetId: inviteId,
      ...extractRequestContext(req),
    });

    return respond({ success: true, message: "Invite revoked" });
  }

  return respond({ error: "No valid update operation provided" }, 400);
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { enterpriseId, inviteId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise invite delete",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Verify invite belongs to this enterprise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite } = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .select("id")
    .eq("id", inviteId)
    .eq("enterprise_id", ctx.enterpriseId)
    .single();

  if (!invite) {
    return respond({ error: "Invite not found" }, 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteError } = await (ctx.serviceSupabase as any)
    .from("enterprise_invites")
    .delete()
    .eq("id", inviteId);

  if (deleteError) {
    return respond({ error: deleteError.message }, 400);
  }

  logEnterpriseAuditAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.userEmail,
    action: "delete_invite",
    enterpriseId: ctx.enterpriseId,
    targetType: "invite",
    targetId: inviteId,
    ...extractRequestContext(req),
  });

  return respond({ success: true, message: "Invite deleted" });
}
