import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";

type ChatGroupMemberInsert = Database["public"]["Tables"]["chat_group_members"]["Insert"];
type ChatGroupMemberUpdate = Database["public"]["Tables"]["chat_group_members"]["Update"];
type ChatGroupInsert = Database["public"]["Tables"]["chat_groups"]["Insert"];

type DirectChatSupabase = Pick<SupabaseClient<Database>, "from">;

type ChatGroupMemberRow = {
  id?: string;
  chat_group_id: string;
  user_id: string;
  removed_at?: string | null;
};

type ChatGroupRow = {
  id: string;
  updated_at?: string | null;
};

export const MOBILE_DISCUSSION_THREADS_TABLE = "discussion_threads" as const;
export const MOBILE_DISCUSSION_AUTHOR_SELECT =
  "author:users!discussion_threads_author_id_fkey(id, name, avatar_url)" as const;
export const MOBILE_CHAT_MEMBER_DIRECTORY_ROLES = [
  "admin",
  "active_member",
  "member",
] as const;

export function buildMobileDiscussionThreadRoute(
  orgSlug: string,
  threadId: string
): string {
  return `/(app)/${orgSlug}/chat/threads/${threadId}`;
}

export function buildMobileNewDiscussionThreadRoute(orgSlug: string): string {
  return `/(app)/${orgSlug}/chat/threads/new`;
}

export function canAccessMobileChatGroup(params: {
  hasActiveMembership: boolean;
  isOrgAdmin: boolean;
}): boolean {
  return params.isOrgAdmin || params.hasActiveMembership;
}

export function canManageMobileChatMembers(params: {
  isOrgAdmin: boolean;
  isGroupModerator: boolean;
  isGroupCreator: boolean;
}): boolean {
  return params.isOrgAdmin || params.isGroupModerator || params.isGroupCreator;
}

export function buildChatGroupMemberInsertPayload(params: {
  groupId: string;
  organizationId: string;
  userId: string;
  addedBy?: string | null;
}): ChatGroupMemberInsert {
  return {
    chat_group_id: params.groupId,
    organization_id: params.organizationId,
    user_id: params.userId,
    role: "member",
    added_by: params.addedBy ?? null,
  };
}

export function buildChatGroupMemberReactivationPayload(
  addedBy?: string | null
): Pick<ChatGroupMemberUpdate, "added_by" | "removed_at"> {
  return {
    added_by: addedBy ?? null,
    removed_at: null,
  };
}

export async function findExactMobileDirectChatGroup(
  supabase: DirectChatSupabase,
  input: {
    organizationId: string;
    senderUserId: string;
    recipientUserId: string;
  }
): Promise<{ chatGroupId: string | null; error: string | null }> {
  const { data: memberships, error: membershipError } = await supabase
    .from("chat_group_members")
    .select("chat_group_id, user_id, removed_at")
    .eq("organization_id", input.organizationId)
    .in("user_id", [input.senderUserId, input.recipientUserId]);

  if (membershipError) {
    return { chatGroupId: null, error: membershipError.message ?? "Chat lookup failed" };
  }

  const membershipMap = new Map<string, Set<string>>();
  for (const row of ((memberships as ChatGroupMemberRow[] | null) ?? [])) {
    if (row.removed_at != null) continue;
    const set = membershipMap.get(row.chat_group_id) ?? new Set<string>();
    set.add(row.user_id);
    membershipMap.set(row.chat_group_id, set);
  }

  const candidateGroupIds = [...membershipMap.entries()]
    .filter(([, userIds]) => userIds.has(input.senderUserId) && userIds.has(input.recipientUserId))
    .map(([groupId]) => groupId);

  if (candidateGroupIds.length === 0) {
    return { chatGroupId: null, error: null };
  }

  const { data: groups, error: groupsError } = await supabase
    .from("chat_groups")
    .select("id, updated_at")
    .eq("organization_id", input.organizationId)
    .is("deleted_at", null)
    .in("id", candidateGroupIds)
    .order("updated_at", { ascending: false });

  if (groupsError) {
    return { chatGroupId: null, error: groupsError.message ?? "Chat lookup failed" };
  }

  const orderedGroups = (groups as ChatGroupRow[] | null) ?? [];
  if (orderedGroups.length === 0) {
    return { chatGroupId: null, error: null };
  }

  const { data: allMemberships, error: allMembershipsError } = await supabase
    .from("chat_group_members")
    .select("chat_group_id, user_id, removed_at")
    .in("chat_group_id", orderedGroups.map((row) => row.id));

  if (allMembershipsError) {
    return { chatGroupId: null, error: allMembershipsError.message ?? "Chat lookup failed" };
  }

  const groupedMemberships = new Map<string, ChatGroupMemberRow[]>();
  for (const row of ((allMemberships as ChatGroupMemberRow[] | null) ?? [])) {
    const rows = groupedMemberships.get(row.chat_group_id) ?? [];
    rows.push(row);
    groupedMemberships.set(row.chat_group_id, rows);
  }

  for (const group of orderedGroups) {
    const rows = groupedMemberships.get(group.id) ?? [];
    if (rows.some((row) => row.removed_at != null)) continue;

    const activeUserIds = [...new Set(rows.map((row) => row.user_id))];
    if (
      activeUserIds.length === 2 &&
      activeUserIds.includes(input.senderUserId) &&
      activeUserIds.includes(input.recipientUserId)
    ) {
      return { chatGroupId: group.id, error: null };
    }
  }

  return { chatGroupId: null, error: null };
}

export async function ensureMobileDirectChatGroup(
  supabase: DirectChatSupabase,
  input: {
    organizationId: string;
    currentUserId: string;
    recipientUserId: string;
    recipientDisplayName: string;
  }
): Promise<{ ok: true; chatGroupId: string } | { ok: false; error: string }> {
  if (input.currentUserId === input.recipientUserId) {
    return { ok: false, error: "You can't message yourself from your own profile." };
  }

  const existing = await findExactMobileDirectChatGroup(supabase, {
    organizationId: input.organizationId,
    senderUserId: input.currentUserId,
    recipientUserId: input.recipientUserId,
  });
  if (existing.error) return { ok: false, error: existing.error };
  if (existing.chatGroupId) return { ok: true, chatGroupId: existing.chatGroupId };

  const chatGroup: ChatGroupInsert = {
    organization_id: input.organizationId,
    name: input.recipientDisplayName,
    description: null,
    is_default: false,
    require_approval: false,
    created_by: input.currentUserId,
  };
  const { data: group, error: groupError } = await supabase
    .from("chat_groups")
    .insert(chatGroup)
    .select("id")
    .single();

  if (groupError || !group?.id) {
    return { ok: false, error: groupError?.message ?? "Failed to create chat." };
  }

  const memberInserts: ChatGroupMemberInsert[] = [
    {
      chat_group_id: group.id,
      organization_id: input.organizationId,
      user_id: input.currentUserId,
      role: "admin",
      added_by: input.currentUserId,
    },
    {
      chat_group_id: group.id,
      organization_id: input.organizationId,
      user_id: input.recipientUserId,
      role: "member",
      added_by: input.currentUserId,
    },
  ];

  const { error: membersError } = await supabase
    .from("chat_group_members")
    .insert(memberInserts);

  if (membersError) {
    return { ok: false, error: membersError.message ?? "Failed to add chat members." };
  }

  return { ok: true, chatGroupId: group.id };
}
