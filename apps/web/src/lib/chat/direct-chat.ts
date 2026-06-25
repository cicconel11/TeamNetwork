import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_ELIGIBLE_ORG_ROLES } from "@/lib/chat/recipient-eligibility";

export type DirectChatSupabase = Pick<SupabaseClient, "from">;

interface MemberRow {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status?: string | null;
  deleted_at?: string | null;
}

interface AlumniRow {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  deleted_at?: string | null;
}

type ChatPersonRow = MemberRow & { profile_kind: "member" | "alumni" };

interface ChatGroupRow {
  id: string;
  updated_at?: string | null;
}

interface ChatGroupMemberRow {
  id?: string;
  chat_group_id: string;
  user_id: string;
  removed_at?: string | null;
}

type RecipientUnavailableReason =
  | "recipient_not_found"
  | "recipient_inactive"
  | "recipient_unlinked"
  | "recipient_self"
  | "recipient_lookup_failed";

export type ChatRecipientResolution =
  | {
      kind: "resolved";
      memberId: string;
      userId: string;
      displayName: string;
      existingChatGroupId: string | null;
    }
  | { kind: "recipient_required" }
  | {
      kind: "ambiguous";
      requestedRecipient: string;
      candidateRecipients: string[];
    }
  | {
      kind: "unavailable";
      requestedRecipient?: string | null;
      reason: RecipientUnavailableReason;
    };

export type SendAiAssistedDirectChatMessageResult =
  | {
      ok: true;
      chatGroupId: string;
      messageId: string;
      reusedExistingChat: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code:
        | "recipient_unavailable"
        | "chat_lookup_failed"
        | "chat_create_failed"
        | "membership_sync_failed"
        | "message_insert_failed";
    };

type DirectChatForUserFailureCode =
  | "sender_inactive"
  | "recipient_inactive"
  | "recipient_self"
  | "recipient_lookup_failed"
  | "chat_lookup_failed"
  | "chat_create_failed"
  | "membership_sync_failed";

export type EnsureDirectChatForUserResult =
  | { ok: true; chatGroupId: string; reused: boolean }
  | {
      ok: false;
      status: number;
      error: string;
      code: DirectChatForUserFailureCode;
    };

function normalizeMatchValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatMemberDisplayName(
  member: Pick<MemberRow, "first_name" | "last_name" | "email">,
): string {
  const name = [member.first_name, member.last_name]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join(" ");

  return name || member.email?.trim() || "Member";
}

function formatCandidateLabel(member: MemberRow): string {
  const name = formatMemberDisplayName(member);
  const email = member.email?.trim();
  if (email && normalizeMatchValue(email) !== normalizeMatchValue(name)) {
    return `${name} <${email}>`;
  }
  return name;
}

function dedupeCandidates(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

async function loadActiveLinkedMembers(
  supabase: DirectChatSupabase,
  organizationId: string,
): Promise<{ data: ChatPersonRow[] | null; error: unknown }> {
  const { data, error } = await supabase
    .from("members")
    .select("id, user_id, first_name, last_name, email, status, deleted_at")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("last_name", { ascending: true });

  if (error) {
    return { data: null, error };
  }

  const linkedMembers = ((data as MemberRow[] | null) ?? []).filter(
    (row): row is MemberRow & { user_id: string } => Boolean(row.user_id)
  );
  if (linkedMembers.length === 0) {
    return { data: [], error: null };
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("user_organization_roles")
    .select("user_id, status")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", CHAT_ELIGIBLE_ORG_ROLES)
    .in("user_id", linkedMembers.map((row) => row.user_id));

  if (membershipsError) {
    return { data: null, error: membershipsError };
  }

  const activeUserIds = new Set(
    ((memberships as Array<{ user_id?: string | null }> | null) ?? [])
      .map((row) => row.user_id)
      .filter((value): value is string => Boolean(value))
  );

  return {
    data: linkedMembers
      .filter((row) => activeUserIds.has(row.user_id))
      .map((row) => ({ ...row, profile_kind: "member" as const })),
    error: null,
  };
}

async function loadActiveLinkedAlumni(
  supabase: DirectChatSupabase,
  organizationId: string,
): Promise<{ data: ChatPersonRow[] | null; error: unknown }> {
  const { data: alumni, error } = await supabase
    .from("alumni")
    .select("id, user_id, first_name, last_name, email, deleted_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("last_name", { ascending: true });

  if (error) {
    return { data: null, error };
  }

  const linkedAlumni = ((alumni as AlumniRow[] | null) ?? []).filter(
    (row): row is AlumniRow & { user_id: string } => Boolean(row.user_id)
  );
  if (linkedAlumni.length === 0) {
    return { data: [], error: null };
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("user_organization_roles")
    .select("user_id, status")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", CHAT_ELIGIBLE_ORG_ROLES)
    .in("user_id", linkedAlumni.map((row) => row.user_id));

  if (membershipsError) {
    return { data: null, error: membershipsError };
  }

  const activeUserIds = new Set(
    ((memberships as Array<{ user_id?: string | null }> | null) ?? [])
      .map((row) => row.user_id)
      .filter((value): value is string => Boolean(value))
  );

  return {
    data: linkedAlumni
      .filter((row) => activeUserIds.has(row.user_id))
      .map((row) => ({
        ...row,
        status: "active",
        profile_kind: "alumni" as const,
      })),
    error: null,
  };
}

async function loadActiveLinkedChatPeople(
  supabase: DirectChatSupabase,
  organizationId: string,
): Promise<{ data: ChatPersonRow[] | null; error: unknown }> {
  const [membersResult, alumniResult] = await Promise.all([
    loadActiveLinkedMembers(supabase, organizationId),
    loadActiveLinkedAlumni(supabase, organizationId),
  ]);

  if (membersResult.error) return membersResult;
  if (alumniResult.error) return alumniResult;

  const peopleByUserId = new Map<string, ChatPersonRow>();
  for (const person of [...(membersResult.data ?? []), ...(alumniResult.data ?? [])]) {
    if (!person.user_id) continue;
    const existing = peopleByUserId.get(person.user_id);
    if (!existing || existing.profile_kind === "alumni") {
      peopleByUserId.set(person.user_id, person);
    }
  }

  return { data: Array.from(peopleByUserId.values()), error: null };
}

function isChatEligibleMember<T extends MemberRow>(
  member: T,
  senderUserId: string,
): member is T & { user_id: string } {
  return Boolean(member.user_id && member.user_id !== senderUserId);
}

async function loadMemberById(
  supabase: DirectChatSupabase,
  organizationId: string,
  memberId: string,
): Promise<{ data: ChatPersonRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("members")
    .select("id, user_id, first_name, last_name, email, status, deleted_at")
    .eq("organization_id", organizationId)
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  const member = (data as MemberRow | null) ?? null;
  if (member) {
    if (!member.user_id || member.deleted_at != null || member.status !== "active") {
      return { data: { ...member, profile_kind: "member" }, error: null };
    }

    const membership = await hasActiveOrgMembership(supabase, {
      organizationId,
      userId: member.user_id,
    });
    if (!membership.ok) {
      return { data: null, error: membership };
    }

    return {
      data: {
        ...member,
        status: membership.active ? "active" : "inactive",
        profile_kind: "member",
      },
      error: null,
    };
  }

  const { data: alumni, error: alumniError } = await supabase
    .from("alumni")
    .select("id, user_id, first_name, last_name, email, deleted_at")
    .eq("organization_id", organizationId)
    .eq("id", memberId)
    .maybeSingle();

  if (alumniError) {
    return { data: null, error: alumniError };
  }

  const alumniRow = (alumni as AlumniRow | null) ?? null;
  if (!alumniRow) {
    return { data: null, error: null };
  }

  if (!alumniRow.user_id || alumniRow.deleted_at != null) {
    return {
      data: {
        ...alumniRow,
        status: alumniRow.deleted_at == null ? "active" : "inactive",
        profile_kind: "alumni",
      },
      error: null,
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("user_organization_roles")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("user_id", alumniRow.user_id)
    .eq("status", "active")
    .in("role", CHAT_ELIGIBLE_ORG_ROLES)
    .maybeSingle();

  if (membershipError) {
    return { data: null, error: membershipError };
  }

  return {
    data: {
      ...alumniRow,
      status: membership ? "active" : "inactive",
      profile_kind: "alumni",
    },
    error: null,
  };
}

async function hasActiveOrgMembership(
  supabase: DirectChatSupabase,
  input: { organizationId: string; userId: string },
): Promise<{ ok: true; active: boolean } | { ok: false }> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("role, status")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .in("role", CHAT_ELIGIBLE_ORG_ROLES)
    .maybeSingle();

  if (error) {
    console.error("[direct-chat] hasActiveOrgMembership lookup failed", {
      organizationId: input.organizationId,
      userId: input.userId,
      error,
    });
    return { ok: false };
  }

  return { ok: true, active: Boolean(data) };
}

export async function findExactDirectChatGroup(
  supabase: DirectChatSupabase,
  input: {
    organizationId: string;
    senderUserId: string;
    recipientUserId: string;
  },
): Promise<{ chatGroupId: string | null; error: RecipientUnavailableReason | "chat_lookup_failed" | null }> {
  const { data: memberships, error: membershipError } = await supabase
    .from("chat_group_members")
    .select("chat_group_id, user_id, removed_at")
    .eq("organization_id", input.organizationId)
    .in("user_id", [input.senderUserId, input.recipientUserId]);

  if (membershipError) {
    return { chatGroupId: null, error: "chat_lookup_failed" };
  }

  const activeMemberships = ((memberships as ChatGroupMemberRow[] | null) ?? []).filter(
    (row) => row.removed_at == null
  );

  const membershipMap = new Map<string, Set<string>>();
  for (const row of activeMemberships) {
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

  const { data: candidateGroups, error: groupsError } = await supabase
    .from("chat_groups")
    .select("id, updated_at")
    .eq("organization_id", input.organizationId)
    .is("deleted_at", null)
    .in("id", candidateGroupIds)
    .order("updated_at", { ascending: false });

  if (groupsError) {
    return { chatGroupId: null, error: "chat_lookup_failed" };
  }

  const orderedGroups = (candidateGroups as ChatGroupRow[] | null) ?? [];
  if (orderedGroups.length === 0) {
    return { chatGroupId: null, error: null };
  }

  const { data: allMemberships, error: allMembershipsError } = await supabase
    .from("chat_group_members")
    .select("chat_group_id, user_id, removed_at")
    .in("chat_group_id", orderedGroups.map((row) => row.id));

  if (allMembershipsError) {
    return { chatGroupId: null, error: "chat_lookup_failed" };
  }

  const groupedMemberships = new Map<string, ChatGroupMemberRow[]>();
  for (const row of ((allMemberships as ChatGroupMemberRow[] | null) ?? [])) {
    const rows = groupedMemberships.get(row.chat_group_id) ?? [];
    rows.push(row);
    groupedMemberships.set(row.chat_group_id, rows);
  }

  for (const group of orderedGroups) {
    const rows = groupedMemberships.get(group.id) ?? [];
    if (rows.some((row) => row.removed_at != null)) {
      continue;
    }

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

export async function resolveChatMessageRecipient(
  supabase: DirectChatSupabase,
  input: {
    organizationId: string;
    senderUserId: string;
    recipientMemberId?: string | null;
    personQuery?: string | null;
  },
): Promise<ChatRecipientResolution> {
  const requestedRecipient =
    typeof input.personQuery === "string" && input.personQuery.trim().length > 0
      ? input.personQuery.trim()
      : null;
  const explicitMemberId =
    typeof input.recipientMemberId === "string" && input.recipientMemberId.trim().length > 0
      ? input.recipientMemberId
      : null;

  if (!explicitMemberId && !requestedRecipient) {
    return { kind: "recipient_required" };
  }

  if (explicitMemberId) {
    const { data: member, error } = await loadMemberById(
      supabase,
      input.organizationId,
      explicitMemberId,
    );

    if (error) {
      return {
        kind: "unavailable",
        requestedRecipient,
        reason: "recipient_lookup_failed",
      };
    }

    if (!member) {
      return {
        kind: "unavailable",
        requestedRecipient,
        reason: "recipient_not_found",
      };
    }

    if (member.deleted_at != null || member.status !== "active") {
      return {
        kind: "unavailable",
        requestedRecipient: requestedRecipient ?? formatMemberDisplayName(member),
        reason: "recipient_inactive",
      };
    }

    if (!member.user_id) {
      return {
        kind: "unavailable",
        requestedRecipient: requestedRecipient ?? formatMemberDisplayName(member),
        reason: "recipient_unlinked",
      };
    }

    if (member.user_id === input.senderUserId) {
      return {
        kind: "unavailable",
        requestedRecipient: requestedRecipient ?? formatMemberDisplayName(member),
        reason: "recipient_self",
      };
    }

    const existing = await findExactDirectChatGroup(supabase, {
      organizationId: input.organizationId,
      senderUserId: input.senderUserId,
      recipientUserId: member.user_id,
    });

    if (existing.error === "chat_lookup_failed") {
      return {
        kind: "unavailable",
        requestedRecipient: requestedRecipient ?? formatMemberDisplayName(member),
        reason: "recipient_lookup_failed",
      };
    }

    return {
      kind: "resolved",
      memberId: member.id,
      userId: member.user_id,
      displayName: formatMemberDisplayName(member),
      existingChatGroupId: existing.chatGroupId,
    };
  }

  const { data: members, error } = await loadActiveLinkedChatPeople(supabase, input.organizationId);
  if (error) {
    return {
      kind: "unavailable",
      requestedRecipient,
      reason: "recipient_lookup_failed",
    };
  }

  const query = normalizeMatchValue(requestedRecipient);
  const rows = (members ?? []).filter((member) => member.user_id !== input.senderUserId);
  const eligibleRows = rows.filter((member): member is ChatPersonRow & { user_id: string } =>
    isChatEligibleMember(member, input.senderUserId)
  );
  const exactMatches = eligibleRows.filter((member) => {
    const displayName = normalizeMatchValue(formatMemberDisplayName(member));
    const email = normalizeMatchValue(member.email);
    return displayName === query || email === query;
  });
  const partialMatches = eligibleRows.filter((member) => {
    const displayName = normalizeMatchValue(formatMemberDisplayName(member));
    const email = normalizeMatchValue(member.email);
    return displayName.includes(query) || email.includes(query);
  });
  const rankedMatches = exactMatches.length > 0 ? exactMatches : partialMatches;

  if (rankedMatches.length === 0) {
    const unavailableMatches = rows.filter((member) => {
      const displayName = normalizeMatchValue(formatMemberDisplayName(member));
      const email = normalizeMatchValue(member.email);
      return displayName.includes(query) || email.includes(query);
    });

    if (unavailableMatches.length > 0) {
      return {
        kind: "unavailable",
        requestedRecipient,
        reason: "recipient_unlinked",
      };
    }

    return {
      kind: "unavailable",
      requestedRecipient,
      reason: "recipient_not_found",
    };
  }

  if (rankedMatches.length > 1) {
    return {
      kind: "ambiguous",
      requestedRecipient: requestedRecipient ?? "",
      candidateRecipients: dedupeCandidates(
        rankedMatches.slice(0, 5).map((member) => formatCandidateLabel(member)),
      ),
    };
  }

  const member = rankedMatches[0];
  if (!member.user_id) {
    return {
      kind: "unavailable",
      requestedRecipient,
      reason: "recipient_unlinked",
    };
  }

  const existing = await findExactDirectChatGroup(supabase, {
    organizationId: input.organizationId,
    senderUserId: input.senderUserId,
    recipientUserId: member.user_id,
  });

  if (existing.error === "chat_lookup_failed") {
    return {
      kind: "unavailable",
      requestedRecipient,
      reason: "recipient_lookup_failed",
    };
  }

  return {
    kind: "resolved",
    memberId: member.id,
    userId: member.user_id,
    displayName: formatMemberDisplayName(member),
    existingChatGroupId: existing.chatGroupId,
  };
}

export async function ensureChatGroupMember(
  supabase: DirectChatSupabase,
  input: {
    chatGroupId: string;
    organizationId: string;
    userId: string;
    role: "admin" | "member";
    addedBy: string;
  },
): Promise<{ ok: true } | { ok: false; code: "membership_sync_failed" }> {
  const { data: existing, error: existingError } = await supabase
    .from("chat_group_members")
    .select("id, removed_at")
    .eq("chat_group_id", input.chatGroupId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, code: "membership_sync_failed" };
  }

  const existingRow = (existing as { id?: string; removed_at?: string | null } | null) ?? null;
  if (existingRow?.id) {
    if (existingRow.removed_at != null) {
      const { error: updateError } = await supabase
        .from("chat_group_members")
        .update({
          role: input.role,
          removed_at: null,
          added_by: input.addedBy,
        })
        .eq("id", existingRow.id);

      if (updateError) {
        return { ok: false, code: "membership_sync_failed" };
      }
    }
    return { ok: true };
  }

  const { error: insertError } = await supabase.from("chat_group_members").insert({
    chat_group_id: input.chatGroupId,
    organization_id: input.organizationId,
    user_id: input.userId,
    role: input.role,
    added_by: input.addedBy,
  });

  if (insertError) {
    return { ok: false, code: "membership_sync_failed" };
  }

  return { ok: true };
}

export async function createDirectChatGroup(
  supabase: DirectChatSupabase,
  input: {
    organizationId: string;
    senderUserId: string;
    recipientDisplayName: string;
  },
): Promise<{ chatGroupId: string | null; error: "chat_create_failed" | null }> {
  const { data, error } = await supabase
    .from("chat_groups")
    .insert({
      organization_id: input.organizationId,
      name: input.recipientDisplayName,
      description: null,
      is_default: false,
      require_approval: false,
      created_by: input.senderUserId,
    })
    .select("id")
    .single();

  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
    return { chatGroupId: null, error: "chat_create_failed" };
  }

  return { chatGroupId: (data as { id: string }).id, error: null };
}

export type EnsureDirectChatGroupResult =
  | { ok: true; chatGroupId: string; reused: boolean }
  | {
      ok: false;
      code:
        | "chat_lookup_failed"
        | "chat_create_failed"
        | "membership_sync_failed"
        | "recipient_lookup_failed";
    };

async function loadUserDisplayName(
  supabase: DirectChatSupabase,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("users")
    .select("name,email")
    .eq("id", userId)
    .maybeSingle();
  const row = (data as { name?: string | null; email?: string | null } | null) ?? null;
  return row?.name?.trim() || row?.email?.trim() || "Member";
}

/**
 * Ensure a 2-member direct chat group exists between two users in an org.
 * Idempotent: reuses an existing exact 2-member group if one exists.
 */
export async function ensureDirectChatGroup(
  supabase: DirectChatSupabase,
  input: { userAId: string; userBId: string; orgId: string },
): Promise<EnsureDirectChatGroupResult> {
  if (input.userAId === input.userBId) {
    return { ok: false, code: "recipient_lookup_failed" };
  }

  const existing = await findExactDirectChatGroup(supabase, {
    organizationId: input.orgId,
    senderUserId: input.userAId,
    recipientUserId: input.userBId,
  });

  if (existing.error === "chat_lookup_failed") {
    return { ok: false, code: "chat_lookup_failed" };
  }

  if (existing.chatGroupId) {
    return { ok: true, chatGroupId: existing.chatGroupId, reused: true };
  }

  const displayName = await loadUserDisplayName(supabase, input.userBId);

  const created = await createDirectChatGroup(supabase, {
    organizationId: input.orgId,
    senderUserId: input.userAId,
    recipientDisplayName: displayName,
  });

  if (created.error || !created.chatGroupId) {
    return { ok: false, code: "chat_create_failed" };
  }

  const chatGroupId = created.chatGroupId;

  const aMembership = await ensureChatGroupMember(supabase, {
    chatGroupId,
    organizationId: input.orgId,
    userId: input.userAId,
    role: "admin",
    addedBy: input.userAId,
  });
  if (!aMembership.ok) return { ok: false, code: aMembership.code };

  const bMembership = await ensureChatGroupMember(supabase, {
    chatGroupId,
    organizationId: input.orgId,
    userId: input.userBId,
    role: "member",
    addedBy: input.userAId,
  });
  if (!bMembership.ok) return { ok: false, code: bMembership.code };

  return { ok: true, chatGroupId, reused: false };
}

export async function ensureDirectChatForUser(
  supabase: DirectChatSupabase,
  input: { organizationId: string; senderUserId: string; recipientUserId: string },
): Promise<EnsureDirectChatForUserResult> {
  if (input.senderUserId === input.recipientUserId) {
    return {
      ok: false,
      status: 409,
      error: "You cannot message yourself.",
      code: "recipient_self",
    };
  }

  const [senderMembership, recipientMembership] = await Promise.all([
    hasActiveOrgMembership(supabase, {
      organizationId: input.organizationId,
      userId: input.senderUserId,
    }),
    hasActiveOrgMembership(supabase, {
      organizationId: input.organizationId,
      userId: input.recipientUserId,
    }),
  ]);

  if (!senderMembership.ok || !recipientMembership.ok) {
    return {
      ok: false,
      status: 500,
      error: "Failed to verify chat access.",
      code: "recipient_lookup_failed",
    };
  }

  if (!senderMembership.active) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to message people in this organization.",
      code: "sender_inactive",
    };
  }

  if (!recipientMembership.active) {
    return {
      ok: false,
      status: 404,
      error: "This person is not available for in-app chat.",
      code: "recipient_inactive",
    };
  }

  const result = await ensureDirectChatGroup(supabase, {
    orgId: input.organizationId,
    userAId: input.senderUserId,
    userBId: input.recipientUserId,
  });

  if (!result.ok) {
    // ensureDirectChatGroup only returns recipient_lookup_failed when the two
    // user ids are equal, which the self-message guard above already rejects —
    // so every code reachable here is a genuine 500 (lookup/create/sync failure).
    return {
      ok: false,
      status: 500,
      error: "Failed to open the chat.",
      code: result.code,
    };
  }

  return result;
}

export async function sendAiAssistedDirectChatMessage(
  supabase: DirectChatSupabase,
  input: {
    organizationId: string;
    senderUserId: string;
    recipientMemberId: string;
    recipientUserId: string;
    recipientDisplayName: string;
    body: string;
  },
): Promise<SendAiAssistedDirectChatMessageResult> {
  const recipient = await resolveChatMessageRecipient(supabase, {
    organizationId: input.organizationId,
    senderUserId: input.senderUserId,
    recipientMemberId: input.recipientMemberId,
  });

  if (recipient.kind !== "resolved" || recipient.userId !== input.recipientUserId) {
    return {
      ok: false,
      status: recipient.kind === "unavailable" ? 409 : 400,
      error:
        recipient.kind === "unavailable"
          ? "The recipient is no longer available for in-app chat."
          : "The recipient could not be resolved for this chat message.",
      code: "recipient_unavailable",
    };
  }

  const existing = await findExactDirectChatGroup(supabase, {
    organizationId: input.organizationId,
    senderUserId: input.senderUserId,
    recipientUserId: input.recipientUserId,
  });

  if (existing.error === "chat_lookup_failed") {
    return {
      ok: false,
      status: 500,
      error: "Failed to resolve the destination chat.",
      code: "chat_lookup_failed",
    };
  }

  let chatGroupId = existing.chatGroupId;
  const reusedExistingChat = Boolean(chatGroupId);

  if (!chatGroupId) {
    const created = await createDirectChatGroup(supabase, {
      organizationId: input.organizationId,
      senderUserId: input.senderUserId,
      recipientDisplayName: input.recipientDisplayName,
    });

    if (created.error || !created.chatGroupId) {
      return {
        ok: false,
        status: 500,
        error: "Failed to create the destination chat.",
        code: "chat_create_failed",
      };
    }

    chatGroupId = created.chatGroupId;

    const senderMembership = await ensureChatGroupMember(supabase, {
      chatGroupId,
      organizationId: input.organizationId,
      userId: input.senderUserId,
      role: "admin",
      addedBy: input.senderUserId,
    });
    if (!senderMembership.ok) {
      return {
        ok: false,
        status: 500,
        error: "Failed to sync the sender into the destination chat.",
        code: senderMembership.code,
      };
    }

    const recipientMembership = await ensureChatGroupMember(supabase, {
      chatGroupId,
      organizationId: input.organizationId,
      userId: input.recipientUserId,
      role: "member",
      addedBy: input.senderUserId,
    });
    if (!recipientMembership.ok) {
      return {
        ok: false,
        status: 500,
        error: "Failed to sync the recipient into the destination chat.",
        code: recipientMembership.code,
      };
    }
  }

  const { data: message, error: messageError } = await supabase
    .from("chat_messages")
    .insert({
      chat_group_id: chatGroupId,
      organization_id: input.organizationId,
      author_id: input.senderUserId,
      body: input.body,
      status: "approved",
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
    chatGroupId,
    messageId: (message as { id: string }).id,
    reusedExistingChat,
  };
}
