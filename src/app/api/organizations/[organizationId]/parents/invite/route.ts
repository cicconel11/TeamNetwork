import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { getOrgMemberRole } from "@/lib/parents/auth";

const createInviteSchema = z.object({
  expires_at: z
    .string()
    .datetime()
    .optional()
    .nullable()
    .refine(
      (v) => v == null || new Date(v) > new Date(),
      { message: "expires_at must be a future date" }
    ),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org parents invite",
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

  // Admin only
  const role = await getOrgMemberRole(supabase, user.id, organizationId);
  if (role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  let body;
  try {
    body = await validateJson(req, createInviteSchema, { maxBodyBytes: 4_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  // Use the authenticated client so auth.uid() is available inside the RPC.
  // Parent invites are now backed by the same organization_invites system as other roles.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: rpcError } = await (supabase as any).rpc("create_org_invite", {
    p_organization_id: organizationId,
    p_role: "parent",
    p_uses: null,
    p_expires_at: body.expires_at ?? null,
  });

  if (rpcError || !invite) {
    console.error("[org/parents/invite POST] RPC error:", rpcError);
    return respond({ error: rpcError?.message || "Failed to create invite" }, 400);
  }

  return respond({
    invite: {
      id: invite.id,
      code: invite.code,
      expires_at: invite.expires_at,
      created_at: invite.created_at,
      status: "pending",
      role: invite.role,
      uses_remaining: invite.uses_remaining,
      revoked_at: invite.revoked_at,
      token: invite.token,
    },
  });
}
