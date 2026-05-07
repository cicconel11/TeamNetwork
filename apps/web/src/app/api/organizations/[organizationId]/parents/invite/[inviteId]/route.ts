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

interface AuthorizedInviteMutationContext {
  organizationId: string;
  inviteId: string;
  respond: (payload: unknown, status?: number) => NextResponse;
  serviceSupabase: ReturnType<typeof createServiceClient>;
}

async function authorizeInviteMutation(
  req: Request,
  params: RouteParams["params"],
  feature: string
): Promise<{ context: AuthorizedInviteMutationContext | null; response: NextResponse | null }> {
  const { organizationId, inviteId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return {
      context: null,
      response: NextResponse.json({ error: "Invalid organization id" }, { status: 400 }),
    };
  }

  const inviteIdParsed = baseSchemas.uuid.safeParse(inviteId);
  if (!inviteIdParsed.success) {
    return {
      context: null,
      response: NextResponse.json({ error: "Invalid invite id" }, { status: 400 }),
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature,
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return { context: null, response: buildRateLimitResponse(rateLimit) };
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return { context: null, response: respond({ error: "Unauthorized" }, 401) };
  }

  // Admin only
  const role = await getOrgMemberRole(supabase, user.id, organizationId);
  if (role !== "admin") {
    return { context: null, response: respond({ error: "Forbidden" }, 403) };
  }

  return {
    context: {
      organizationId,
      inviteId,
      respond,
      serviceSupabase: createServiceClient(),
    },
    response: null,
  };
}

async function fetchParentInvite(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  organizationId: string,
  inviteId: string
) {
  // Fetch the invite to validate ownership and current status.
  // Check both legacy parent_invites table and new organization_invites table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyResult = await (serviceSupabase as any)
    .from("parent_invites")
    .select("id,status")
    .eq("id", inviteId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (legacyResult.data) {
    return { ...legacyResult, source: "legacy" as const };
  }

  // Check new-style parent invites in organization_invites
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgInviteResult = await (serviceSupabase as any)
    .from("organization_invites")
    .select("id,revoked_at,expires_at")
    .eq("id", inviteId)
    .eq("organization_id", organizationId)
    .eq("role", "parent")
    .maybeSingle();

  if (orgInviteResult.data) {
    return { ...orgInviteResult, source: "org_invite" as const };
  }

  // Neither table has the invite
  return legacyResult.error
    ? { ...legacyResult, source: null }
    : orgInviteResult.error
      ? { ...orgInviteResult, source: null }
      : { data: null, error: null, source: null };
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { context, response } = await authorizeInviteMutation(req, params, "org parents invite revoke");
  if (response) {
    return response;
  }

  const { organizationId, inviteId, respond, serviceSupabase } = context!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await fetchParentInvite(serviceSupabase, organizationId, inviteId);
  const { data: invite, error: fetchError, source } = result;

  if (fetchError) {
    console.error("[org/parents/invite/[inviteId] PATCH] DB fetch error:", fetchError);
    return respond({ error: "Failed to fetch invite" }, 500);
  }

  if (!invite || !source) {
    return respond({ error: "Invite not found" }, 404);
  }

  // Handle legacy parent_invites
  if (source === "legacy") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyInvite = invite as any;
    if (legacyInvite.status === "accepted") {
      return respond({ error: "Invite already accepted — cannot revoke" }, 409);
    }

    // Idempotent: already revoked is success
    if (legacyInvite.status === "revoked") {
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

  // Handle new organization_invites
  if (source === "org_invite") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgInvite = invite as any;
    if (orgInvite.revoked_at) {
      return respond({ success: true }); // Already revoked — idempotent
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (serviceSupabase as any)
      .from("organization_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
      .is("revoked_at", null); // Only update if not already revoked

    if (updateError) {
      console.error("[org/parents/invite/[inviteId] PATCH] DB update error:", updateError);
      return respond({ error: "Failed to revoke invite" }, 500);
    }

    return respond({ success: true });
  }

  return respond({ error: "Internal server error" }, 500);
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { context, response } = await authorizeInviteMutation(req, params, "org parents invite delete");
  if (response) {
    return response;
  }

  const { organizationId, inviteId, respond, serviceSupabase } = context!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await fetchParentInvite(serviceSupabase, organizationId, inviteId);
  const { data: invite, error: fetchError, source } = result;

  if (fetchError) {
    console.error("[org/parents/invite/[inviteId] DELETE] DB fetch error:", fetchError);
    return respond({ error: "Failed to fetch invite" }, 500);
  }

  if (!invite || !source) {
    return respond({ error: "Invite not found" }, 404);
  }

  // Delete from the appropriate table
  const tableName = source === "legacy" ? "parent_invites" : "organization_invites";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteError } = await (serviceSupabase as any)
    .from(tableName)
    .delete()
    .eq("id", inviteId)
    .eq("organization_id", organizationId);

  if (deleteError) {
    console.error("[org/parents/invite/[inviteId] DELETE] DB delete error:", deleteError);
    return respond({ error: "Failed to delete invite" }, 500);
  }

  return respond({ success: true });
}
