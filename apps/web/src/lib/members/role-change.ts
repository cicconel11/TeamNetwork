export const MEMBER_ROLES = ["admin", "active_member", "alumni", "parent"] as const;
export const MEMBER_STATUSES = ["active", "revoked", "pending"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

type SupabaseError = { message: string; code?: string };

type SupabaseResult<T> = Promise<{ data: T | null; error: SupabaseError | null }> | { data: T | null; error: SupabaseError | null };
type SupabaseListResult<T> =
  | Promise<{ data: T[] | null; error: SupabaseError | null }>
  | { data: T[] | null; error: SupabaseError | null };

type QueryBuilder<T> = {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): QueryBuilder<T>;
  update(values: Record<string, unknown>): QueryBuilder<T>;
  insert(values: Record<string, unknown>): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  is(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  maybeSingle(): SupabaseResult<T>;
  single(): SupabaseResult<T>;
} & PromiseLike<{ data: T[] | null; error: SupabaseError | null; count?: number | null }>;

export type MemberRoleChangeClient = {
  from(table: string): QueryBuilder<Record<string, unknown>>;
};

export type MemberRoleChangeRequest = {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  role?: MemberRole;
  status?: MemberStatus;
  reason?: string | null;
};

export type ExecuteMemberRoleChangeRequest = MemberRoleChangeRequest & {
  source: "ai_pending_action" | "manual";
  pendingActionId?: string | null;
};

export type PreparedMemberRoleChange =
  | {
      state: "valid";
      currentRole: MemberRole;
      currentStatus: MemberStatus;
      nextRole: MemberRole;
      nextStatus: MemberStatus;
      roleChanged: boolean;
      statusChanged: boolean;
    }
  | {
      state: "invalid";
      reason: "target_not_found" | "no_change";
    }
  | {
      state: "error";
      reason:
        | "last_admin_self_demotion"
        | "last_admin_target_demotion"
        | "alumni_upgrade_required"
        | "parent_upgrade_required"
        | "actor_not_admin"
        | "lookup_failed"
        | "update_failed"
        | "audit_failed";
      message: string;
    };

export type ExecutedMemberRoleChange =
  | (Extract<PreparedMemberRoleChange, { state: "error" | "invalid" }>)
  | (Omit<Extract<PreparedMemberRoleChange, { state: "valid" }>, "state"> & { state: "executed" });

type MembershipRow = {
  role?: string | null;
  status?: string | null;
};

type SubscriptionRow = {
  status?: string | null;
  alumni_bucket?: string | null;
  parents_bucket?: string | null;
};

type MemberDirectoryRow = {
  id?: string | null;
  user_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export type MemberRoleChangeTargetCandidate = {
  memberId: string;
  userId: string;
  name: string;
  email: string | null;
};

export type MemberRoleChangeTargetResolution =
  | {
      state: "resolved";
      memberId: string;
      userId: string;
      displayName: string;
      email: string | null;
    }
  | {
      state: "missing_target";
    }
  | {
      state: "ambiguous";
      requestedTarget: string;
      candidates: MemberRoleChangeTargetCandidate[];
    }
  | {
      state: "target_not_found";
      requestedTarget: string | null;
    }
  | {
      state: "target_unlinked";
      requestedTarget: string | null;
    }
  | {
      state: "error";
      message: string;
    };

function asRole(role: string | null | undefined): MemberRole {
  return MEMBER_ROLES.includes(role as MemberRole) ? (role as MemberRole) : "active_member";
}

function asStatus(status: string | null | undefined): MemberStatus {
  return MEMBER_STATUSES.includes(status as MemberStatus) ? (status as MemberStatus) : "active";
}

function isAdminDemotion(currentRole: MemberRole, nextRole: MemberRole, nextStatus: MemberStatus) {
  return currentRole === "admin" && (nextRole !== "admin" || nextStatus !== "active");
}

function normalizeMatchValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatMemberDisplayName(member: MemberDirectoryRow): string {
  const name = [member.first_name, member.last_name]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");

  return name || member.email?.trim() || "Member";
}

function toCandidate(member: MemberDirectoryRow & { id: string; user_id: string }): MemberRoleChangeTargetCandidate {
  return {
    memberId: member.id,
    userId: member.user_id,
    name: formatMemberDisplayName(member),
    email: member.email?.trim() || null,
  };
}

export async function resolveMemberRoleChangeTarget(
  supabase: MemberRoleChangeClient,
  input: {
    organizationId: string;
    targetMemberId?: string | null;
    targetUserId?: string | null;
    personQuery?: string | null;
  },
): Promise<MemberRoleChangeTargetResolution> {
  if (input.targetUserId) {
    const { data, error } = await supabase
      .from("members")
      .select("id,user_id,first_name,last_name,email")
      .eq("organization_id", input.organizationId)
      .eq("user_id", input.targetUserId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) return { state: "error", message: error.message };
    if (!data || !data.id) {
      return { state: "target_not_found", requestedTarget: input.targetUserId };
    }

    const member = data as MemberDirectoryRow;
    return {
      state: "resolved",
      memberId: member.id ?? input.targetUserId,
      userId: input.targetUserId,
      displayName: formatMemberDisplayName(member),
      email: member.email?.trim() || null,
    };
  }

  if (input.targetMemberId) {
    const { data, error } = await supabase
      .from("members")
      .select("id,user_id,first_name,last_name,email")
      .eq("organization_id", input.organizationId)
      .eq("id", input.targetMemberId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) return { state: "error", message: error.message };
    if (!data) return { state: "target_not_found", requestedTarget: input.targetMemberId };

    const member = data as MemberDirectoryRow;
    if (!member.user_id) {
      return { state: "target_unlinked", requestedTarget: formatMemberDisplayName(member) };
    }

    return {
      state: "resolved",
      memberId: member.id ?? input.targetMemberId,
      userId: member.user_id,
      displayName: formatMemberDisplayName(member),
      email: member.email?.trim() || null,
    };
  }

  const requestedTarget = input.personQuery?.trim();
  if (!requestedTarget) {
    return { state: "missing_target" };
  }

  const { data, error } = await supabase
    .from("members")
    .select("id,user_id,first_name,last_name,email")
    .eq("organization_id", input.organizationId)
    .is("deleted_at", null)
    .order("last_name", { ascending: true });

  if (error) return { state: "error", message: error.message };

  const query = normalizeMatchValue(requestedTarget);
  const linkedMembers = ((data as MemberDirectoryRow[] | null) ?? []).filter(
    (member): member is MemberDirectoryRow & { id: string; user_id: string } =>
      Boolean(member.id && member.user_id),
  );
  const exactMatches = linkedMembers.filter((member) => {
    const displayName = normalizeMatchValue(formatMemberDisplayName(member));
    const email = normalizeMatchValue(member.email);
    return displayName === query || email === query;
  });
  const partialMatches = linkedMembers.filter((member) => {
    const displayName = normalizeMatchValue(formatMemberDisplayName(member));
    const email = normalizeMatchValue(member.email);
    return displayName.includes(query) || email.includes(query);
  });
  const matches = exactMatches.length > 0 ? exactMatches : partialMatches;

  if (matches.length === 0) {
    return { state: "target_not_found", requestedTarget };
  }
  if (matches.length > 1) {
    return {
      state: "ambiguous",
      requestedTarget,
      candidates: matches.slice(0, 5).map(toCandidate),
    };
  }

  const member = matches[0];
  return {
    state: "resolved",
    memberId: member.id,
    userId: member.user_id,
    displayName: formatMemberDisplayName(member),
    email: member.email?.trim() || null,
  };
}

async function loadMembership(
  supabase: MemberRoleChangeClient,
  organizationId: string,
  userId: string,
): Promise<{ row: MembershipRow | null; error: SupabaseError | null }> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  return { row: data as MembershipRow | null, error };
}

async function loadTargetMembership(
  supabase: MemberRoleChangeClient,
  input: MemberRoleChangeRequest,
): Promise<{ row: MembershipRow | null; error: SupabaseError | null }> {
  return loadMembership(supabase, input.organizationId, input.targetUserId);
}

async function loadSubscription(
  supabase: MemberRoleChangeClient,
  organizationId: string,
): Promise<{ row: SubscriptionRow | null; error: SupabaseError | null }> {
  const { data, error } = await supabase
    .from("organization_subscriptions")
    .select("status,alumni_bucket,parents_bucket")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return { row: data as SubscriptionRow | null, error };
}

async function countActiveAdmins(
  supabase: MemberRoleChangeClient,
  organizationId: string,
): Promise<{ count: number; error: SupabaseError | null }> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .eq("status", "active") as Awaited<SupabaseListResult<Record<string, unknown>>>;

  return { count: data?.length ?? 0, error };
}

export async function prepareMemberRoleChange(
  supabase: MemberRoleChangeClient,
  input: MemberRoleChangeRequest,
): Promise<PreparedMemberRoleChange> {
  const { row: actorRow, error: actorError } = await loadMembership(
    supabase,
    input.organizationId,
    input.actorUserId,
  );
  if (actorError) {
    return { state: "error", reason: "lookup_failed", message: actorError.message };
  }
  if (!actorRow || asRole(actorRow.role) !== "admin" || asStatus(actorRow.status) !== "active") {
    return {
      state: "error",
      reason: "actor_not_admin",
      message: "Only active admins can change member roles.",
    };
  }

  const { row, error } = await loadTargetMembership(supabase, input);
  if (error) {
    return { state: "error", reason: "lookup_failed", message: error.message };
  }
  if (!row) {
    return { state: "invalid", reason: "target_not_found" };
  }

  const currentRole = asRole(row.role);
  const currentStatus = asStatus(row.status);
  const nextRole = input.role ?? currentRole;
  const nextStatus = input.status ?? currentStatus;
  const roleChanged = nextRole !== currentRole;
  const statusChanged = nextStatus !== currentStatus;

  if (!roleChanged && !statusChanged) {
    return { state: "invalid", reason: "no_change" };
  }

  if (isAdminDemotion(currentRole, nextRole, nextStatus)) {
    const { count, error: adminError } = await countActiveAdmins(supabase, input.organizationId);
    if (adminError) {
      return { state: "error", reason: "lookup_failed", message: adminError.message };
    }
    if (count <= 1) {
      if (input.actorUserId === input.targetUserId) {
        return {
          state: "error",
          reason: "last_admin_self_demotion",
          message: "You are the only admin in this organization.",
        };
      }
      return {
        state: "error",
        reason: "last_admin_target_demotion",
        message: "Cannot demote the only admin.",
      };
    }
  }

  if (nextRole === "alumni" || nextRole === "parent") {
    const { row: subscription, error: subscriptionError } = await loadSubscription(supabase, input.organizationId);
    if (subscriptionError) {
      return { state: "error", reason: "lookup_failed", message: subscriptionError.message };
    }
    const enterpriseManaged = subscription?.status === "enterprise_managed";
    if (nextRole === "alumni" && !enterpriseManaged && subscription?.alumni_bucket === "none") {
      return {
        state: "error",
        reason: "alumni_upgrade_required",
        message: "Upgrade required for alumni role.",
      };
    }
    if (nextRole === "parent" && !enterpriseManaged && subscription?.parents_bucket === "none") {
      return {
        state: "error",
        reason: "parent_upgrade_required",
        message: "Upgrade required for parent role.",
      };
    }
  }

  return {
    state: "valid",
    currentRole,
    currentStatus,
    nextRole,
    nextStatus,
    roleChanged,
    statusChanged,
  };
}

export async function executeMemberRoleChange(
  supabase: MemberRoleChangeClient,
  input: ExecuteMemberRoleChangeRequest,
): Promise<ExecutedMemberRoleChange> {
  const prepared = await prepareMemberRoleChange(supabase, input);
  if (prepared.state !== "valid") {
    return prepared;
  }

  const updatePayload: Record<string, unknown> = {};
  if (prepared.roleChanged) updatePayload.role = prepared.nextRole;
  if (prepared.statusChanged) updatePayload.status = prepared.nextStatus;

  const { error: updateError } = await supabase
    .from("user_organization_roles")
    .update(updatePayload)
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.targetUserId);

  if (updateError) {
    return { state: "error", reason: "update_failed", message: updateError.message };
  }

  const { error: auditError } = await supabase.from("org_member_role_audit").insert({
    organization_id: input.organizationId,
    target_user_id: input.targetUserId,
    actor_user_id: input.actorUserId,
    pending_action_id: input.pendingActionId ?? null,
    source: input.source,
    previous_role: prepared.currentRole,
    new_role: prepared.nextRole,
    previous_status: prepared.currentStatus,
    new_status: prepared.nextStatus,
    reason: input.reason ?? null,
  });

  if (auditError) {
    return { state: "error", reason: "audit_failed", message: auditError.message };
  }

  return { ...prepared, state: "executed" };
}
