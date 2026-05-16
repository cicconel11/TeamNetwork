import type { Database } from "@teammeet/types";

type ChatGroupMemberInsert = Database["public"]["Tables"]["chat_group_members"]["Insert"];
type ChatGroupMemberUpdate = Database["public"]["Tables"]["chat_group_members"]["Update"];

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
