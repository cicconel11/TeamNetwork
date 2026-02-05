import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { reinstateToActiveMember } from "@/lib/graduation/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; memberId: string }>;
}

/**
 * Reinstate a graduated alumni back to active member status (pending approval).
 *
 * Preconditions:
 * - User must be admin of the organization
 * - Member must have a user_id (linked user account)
 * - Member must be currently graduated (graduated_at is set) OR role is "alumni"
 *
 * Actions:
 * 1. Clear members.graduated_at
 * 2. Clear members.graduation_warning_sent_at
 * 3. Update user_organization_roles.role = "active_member"
 * 4. Update user_organization_roles.status = "pending"
 */
export async function POST(_req: Request, { params }: RouteParams) {
  const { organizationId, memberId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const memberIdParsed = baseSchemas.uuid.safeParse(memberId);
  if (!memberIdParsed.success) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(_req, {
    userId: user?.id ?? null,
    feature: "member reinstate",
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

  // Require admin role in the organization
  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const serviceSupabase = createServiceClient();

  // Fetch member to check preconditions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member, error: memberError } = await (serviceSupabase.from("members") as any)
    .select("id, user_id, graduated_at")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .single();

  if (memberError || !member) {
    return respond({ error: "Member not found" }, 404);
  }

  if (!member.user_id) {
    return respond({ error: "Member does not have a linked user account" }, 400);
  }

  // Check current role
  const { data: currentRole } = await serviceSupabase
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", member.user_id)
    .maybeSingle();

  // Member must be alumni or have graduated_at set
  const isAlumni = currentRole?.role === "alumni";
  const hasGraduated = !!member.graduated_at;

  if (!isAlumni && !hasGraduated) {
    return respond({ error: "Member is not graduated or alumni" }, 400);
  }

  // Perform reinstatement
  const result = await reinstateToActiveMember(
    serviceSupabase,
    memberId,
    member.user_id,
    organizationId
  );

  if (!result.success) {
    return respond({ error: result.error || "Failed to reinstate member" }, 500);
  }

  return respond({
    success: true,
    message: "Member reinstated pending approval",
  });
}
