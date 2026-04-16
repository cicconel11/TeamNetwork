import type { SupabaseClient } from "@supabase/supabase-js";

export type GroupChatSupabase = Pick<SupabaseClient, "from">;

interface ChatGroupRow {
  id: string;
  name: string;
  description: string | null;
  require_approval: boolean;
  updated_at: string | null;
  deleted_at: string | null;
}

interface ChatGroupMemberRow {
  chat_group_id: string;
  role: "admin" | "moderator" | "member";
  chat_groups: ChatGroupRow;
}

export interface UserChatGroup {
  id: string;
  name: string;
  description: string | null;
  role: "admin" | "moderator" | "member";
  updated_at: string | null;
}

type GroupTargetUnavailableReason =
  | "group_not_found"
  | "group_deleted"
  | "not_a_member"
  | "lookup_failed";

export type GroupChatTargetResolution =
  | {
      kind: "resolved";
      chatGroupId: string;
      groupName: string;
      messageStatus: "approved" | "pending";
    }
  | { kind: "group_required" }
  | {
      kind: "ambiguous";
      requestedGroup: string;
      candidateGroups: Array<{ id: string; name: string }>;
    }
  | {
      kind: "unavailable";
      requestedGroup?: string | null;
      reason: GroupTargetUnavailableReason;
    };

export type SendAiAssistedGroupChatMessageResult =
  | {
      ok: true;
      chatGroupId: string;
      messageId: string;
      messageStatus: "approved" | "pending";
    }
  | {
      ok: false;
      status: number;
      error: string;
      code:
        | "group_unavailable"
        | "not_a_member"
        | "message_insert_failed";
    };

function normalizeMatchValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Lists chat groups the user belongs to within an organization.
 * Returns groups ordered by most recently updated.
 */
export async function listUserChatGroups(
  supabase: GroupChatSupabase,
  input: {
    organizationId: string;
    userId: string;
    limit?: number;
  }
): Promise<{ data: UserChatGroup[] | null; error: unknown }> {
  const limit = Math.min(input.limit ?? 25, 50);

  const { data, error } = await supabase
    .from("chat_group_members")
    .select(
      `chat_group_id, role, chat_groups!inner(id, name, description, require_approval, updated_at, deleted_at)`
    )
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .is("removed_at", null)
    .order("updated_at", { ascending: false, referencedTable: "chat_groups" })
    .limit(limit);

  if (error) {
    return { data: null, error };
  }

  const rows = (data as unknown as ChatGroupMemberRow[] | null) ?? [];

  // Filter out soft-deleted groups
  const activeGroups = rows
    .filter((row) => row.chat_groups.deleted_at === null)
    .map((row) => ({
      id: row.chat_groups.id,
      name: row.chat_groups.name,
      description: row.chat_groups.description,
      role: row.role,
      updated_at: row.chat_groups.updated_at,
    }));

  return { data: activeGroups, error: null };
}

/**
 * Resolves a chat group target by UUID or name search.
 * Determines message status based on group settings and user role.
 */
export async function resolveGroupChatTarget(
  supabase: GroupChatSupabase,
  input: {
    organizationId: string;
    userId: string;
    chatGroupId?: string | null;
    groupNameQuery?: string | null;
  }
): Promise<GroupChatTargetResolution> {
  const explicitGroupId =
    typeof input.chatGroupId === "string" && input.chatGroupId.trim().length > 0
      ? input.chatGroupId.trim()
      : null;
  const requestedGroup =
    typeof input.groupNameQuery === "string" && input.groupNameQuery.trim().length > 0
      ? input.groupNameQuery.trim()
      : null;

  if (!explicitGroupId && !requestedGroup) {
    return { kind: "group_required" };
  }

  // If explicit group ID provided, resolve directly
  if (explicitGroupId) {
    const { data: membership, error: membershipError } = await supabase
      .from("chat_group_members")
      .select("role, chat_groups!inner(id, name, require_approval, deleted_at)")
      .eq("chat_group_id", explicitGroupId)
      .eq("user_id", input.userId)
      .eq("organization_id", input.organizationId)
      .is("removed_at", null)
      .maybeSingle();

    if (membershipError) {
      return {
        kind: "unavailable",
        requestedGroup,
        reason: "lookup_failed",
      };
    }

    if (!membership) {
      return {
        kind: "unavailable",
        requestedGroup,
        reason: "not_a_member",
      };
    }

    const membershipRow = membership as unknown as {
      role: "admin" | "moderator" | "member";
      chat_groups: {
        id: string;
        name: string;
        require_approval: boolean;
        deleted_at: string | null;
      };
    };

    if (membershipRow.chat_groups.deleted_at !== null) {
      return {
        kind: "unavailable",
        requestedGroup: membershipRow.chat_groups.name,
        reason: "group_deleted",
      };
    }

    // Determine message status
    const requiresApproval = membershipRow.chat_groups.require_approval;
    const isModOrAdmin = membershipRow.role === "admin" || membershipRow.role === "moderator";
    const messageStatus: "approved" | "pending" = !requiresApproval || isModOrAdmin ? "approved" : "pending";

    return {
      kind: "resolved",
      chatGroupId: membershipRow.chat_groups.id,
      groupName: membershipRow.chat_groups.name,
      messageStatus,
    };
  }

  // Search by name
  const { data: memberships, error: membershipsError } = await supabase
    .from("chat_group_members")
    .select("role, chat_groups!inner(id, name, require_approval, deleted_at)")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .is("removed_at", null);

  if (membershipsError) {
    return {
      kind: "unavailable",
      requestedGroup,
      reason: "lookup_failed",
    };
  }

  const rows = ((memberships as unknown as Array<{
    role: "admin" | "moderator" | "member";
    chat_groups: {
      id: string;
      name: string;
      require_approval: boolean;
      deleted_at: string | null;
    };
  }> | null) ?? []).filter((row) => row.chat_groups.deleted_at === null);

  const query = normalizeMatchValue(requestedGroup);

  // Exact matches first
  const exactMatches = rows.filter(
    (row) => normalizeMatchValue(row.chat_groups.name) === query
  );

  // Partial matches
  const partialMatches = rows.filter(
    (row) => normalizeMatchValue(row.chat_groups.name).includes(query)
  );

  const rankedMatches = exactMatches.length > 0 ? exactMatches : partialMatches;

  if (rankedMatches.length === 0) {
    return {
      kind: "unavailable",
      requestedGroup,
      reason: "group_not_found",
    };
  }

  if (rankedMatches.length > 1) {
    return {
      kind: "ambiguous",
      requestedGroup: requestedGroup ?? "",
      candidateGroups: rankedMatches.slice(0, 5).map((row) => ({
        id: row.chat_groups.id,
        name: row.chat_groups.name,
      })),
    };
  }

  const match = rankedMatches[0];
  const requiresApproval = match.chat_groups.require_approval;
  const isModOrAdmin = match.role === "admin" || match.role === "moderator";
  const messageStatus: "approved" | "pending" = !requiresApproval || isModOrAdmin ? "approved" : "pending";

  return {
    kind: "resolved",
    chatGroupId: match.chat_groups.id,
    groupName: match.chat_groups.name,
    messageStatus,
  };
}

/**
 * Sends a message to a chat group on behalf of a user.
 * Re-validates membership at execution time (TOCTOU protection).
 */
export async function sendAiAssistedGroupChatMessage(
  supabase: GroupChatSupabase,
  input: {
    organizationId: string;
    senderUserId: string;
    chatGroupId: string;
    groupName: string;
    messageStatus: "approved" | "pending";
    body: string;
  }
): Promise<SendAiAssistedGroupChatMessageResult> {
  // Re-validate membership at execution time
  const resolution = await resolveGroupChatTarget(supabase, {
    organizationId: input.organizationId,
    userId: input.senderUserId,
    chatGroupId: input.chatGroupId,
  });

  if (resolution.kind !== "resolved") {
    const reason = resolution.kind === "unavailable" ? resolution.reason : resolution.kind;
    return {
      ok: false,
      status: reason === "not_a_member" ? 403 : 400,
      error:
        reason === "not_a_member"
          ? "You are no longer a member of this chat group."
          : "The chat group is no longer available.",
      code: reason === "not_a_member" ? "not_a_member" : "group_unavailable",
    };
  }

  // Use the current message status (may have changed since prepare time)
  const currentMessageStatus = resolution.messageStatus;

  const { data: message, error: messageError } = await supabase
    .from("chat_messages")
    .insert({
      chat_group_id: input.chatGroupId,
      organization_id: input.organizationId,
      author_id: input.senderUserId,
      body: input.body,
      status: currentMessageStatus,
      metadata: {
        ai_assisted: true,
      },
    })
    .select("id")
    .single();

  if (messageError || !message || typeof (message as { id?: unknown }).id !== "string") {
    return {
      ok: false,
      status: 500,
      error: "Failed to send the chat message.",
      code: "message_insert_failed",
    };
  }

  return {
    ok: true,
    chatGroupId: input.chatGroupId,
    messageId: (message as { id: string }).id,
    messageStatus: currentMessageStatus,
  };
}
