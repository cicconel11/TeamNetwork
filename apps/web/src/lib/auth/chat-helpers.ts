import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface ChatGroup {
  id: string;
  organization_id: string;
  require_approval: boolean;
  deleted_at: string | null;
}

interface OrgRole {
  role: string;
}

interface GroupMembership {
  id: string;
  role: string;
  joined_at: string;
}

type ChatGroupContextSuccess = {
  ok: true;
  group: ChatGroup;
  orgRole: OrgRole;
  membership: GroupMembership | null;
  isOrgAdmin: boolean;
  isGroupMod: boolean;
  canModerate: boolean;
};

type ChatGroupContextFailure = {
  ok: false;
  error: string;
  status: number;
};

export type ChatGroupContext = ChatGroupContextSuccess | ChatGroupContextFailure;

/**
 * Validates group access for chat API routes.
 * Checks: group exists, user has active org membership, user is group member or org admin.
 */
export async function getChatGroupContext(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
): Promise<ChatGroupContext> {
  // Load group
  const { data: group, error: groupError } = await supabase
    .from("chat_groups")
    .select("id, organization_id, require_approval, deleted_at")
    .eq("id", groupId)
    .is("deleted_at", null)
    .single();

  if (groupError && groupError.code !== "PGRST116") {
    console.error("[chat-auth] group query failed", { groupId, userId, error: groupError.message });
    return { ok: false, error: "Internal error", status: 500 };
  }

  if (!group) {
    return { ok: false, error: "Group not found", status: 404 };
  }

  // Check org membership with active status
  const { data: orgRole, error: orgRoleError } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", group.organization_id)
    .eq("status", "active")
    .maybeSingle();

  if (orgRoleError) {
    console.error("[chat-auth] org role query failed", {
      groupId,
      userId,
      organizationId: group.organization_id,
      error: orgRoleError.message,
    });
    return { ok: false, error: "Internal error", status: 500 };
  }

  if (!orgRole) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const isOrgAdmin = orgRole.role === "admin";

  // Check group membership
  const { data: membership, error: membershipError } = await supabase
    .from("chat_group_members")
    .select("id, role, joined_at")
    .eq("chat_group_id", groupId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (membershipError) {
    console.error("[chat-auth] membership query failed", { groupId, userId, error: membershipError.message });
    return { ok: false, error: "Internal error", status: 500 };
  }

  if (!membership && !isOrgAdmin) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const isGroupMod = membership?.role === "admin" || membership?.role === "moderator";
  const canModerate = isOrgAdmin || isGroupMod;

  return {
    ok: true,
    group,
    orgRole,
    membership,
    isOrgAdmin,
    isGroupMod,
    canModerate,
  };
}
