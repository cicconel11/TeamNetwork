import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { getOrgMemberRole } from "@/lib/parents/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; inviteId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, inviteId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const inviteIdParsed = baseSchemas.uuid.safeParse(inviteId);
  if (!inviteIdParsed.success) {
    return NextResponse.json({ error: "Invalid invite id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org parents invite revoke",
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

  // Admin only
  const role = await getOrgMemberRole(supabase, user.id, organizationId);
  if (role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const serviceSupabase = createServiceClient();

  // Fetch the invite to validate ownership and current status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: fetchError } = await (serviceSupabase as any)
    .from("parent_invites")
    .select("id,status")
    .eq("id", inviteId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError) {
    console.error("[org/parents/invite/[inviteId] PATCH] DB fetch error:", fetchError);
    return respond({ error: "Failed to fetch invite" }, 500);
  }

  if (!invite) {
    return respond({ error: "Invite not found" }, 404);
  }

  if (invite.status === "accepted") {
    return respond({ error: "Invite already accepted — cannot revoke" }, 409);
  }

  // Idempotent: already revoked is success
  if (invite.status === "revoked") {
    return respond({ success: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (serviceSupabase as any)
    .from("parent_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending");

  if (updateError) {
    console.error("[org/parents/invite/[inviteId] PATCH] DB update error:", updateError);
    return respond({ error: "Failed to revoke invite" }, 500);
  }

  return respond({ success: true });
}
