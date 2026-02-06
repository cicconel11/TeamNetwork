import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAlumniLimit } from "@/lib/alumni-quota";
import { debugLog, maskPII } from "@/lib/debug";

export interface GraduatingMember {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization_id: string;
  expected_graduation_date: string;
}

export interface OrgWithSlug {
  id: string;
  name: string;
  slug: string;
}

/**
 * Get members graduating within the specified number of days
 * who haven't received a warning yet.
 *
 * Note: Uses type assertions because the generated types may not include
 * the graduation tracking columns (user_id, expected_graduation_date,
 * graduated_at, graduation_warning_sent_at) until types are regenerated.
 */
export async function getMembersNearingGraduation(
  supabase: SupabaseClient<Database>,
  daysAhead: number
): Promise<GraduatingMember[]> {
  const today = new Date();
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + daysAhead);

  const todayStr = today.toISOString().split("T")[0];
  const futureDateStr = futureDate.toISOString().split("T")[0];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = supabase.from("members") as any;
  const { data, error } = await query
    .select("id, user_id, first_name, last_name, email, organization_id, expected_graduation_date")
    .is("deleted_at", null)
    .is("graduated_at", null)
    .is("graduation_warning_sent_at", null)
    .not("expected_graduation_date", "is", null)
    .gte("expected_graduation_date", todayStr)
    .lte("expected_graduation_date", futureDateStr);

  if (error) {
    console.error("[graduation] Error fetching members nearing graduation:", error);
    throw error;
  }

  return (data || []) as GraduatingMember[];
}

/**
 * Get members past their graduation date who haven't been transitioned yet.
 */
export async function getMembersPastGraduation(
  supabase: SupabaseClient<Database>
): Promise<GraduatingMember[]> {
  const today = new Date().toISOString().split("T")[0];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = supabase.from("members") as any;
  const { data, error } = await query
    .select("id, user_id, first_name, last_name, email, organization_id, expected_graduation_date")
    .is("deleted_at", null)
    .is("graduated_at", null)
    .not("expected_graduation_date", "is", null)
    .lte("expected_graduation_date", today);

  if (error) {
    console.error("[graduation] Error fetching members past graduation:", error);
    throw error;
  }

  return (data || []) as GraduatingMember[];
}

/**
 * Get organization details with slug for URL generation.
 */
export async function getOrganization(
  supabase: SupabaseClient<Database>,
  orgId: string
): Promise<OrgWithSlug | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("id", orgId)
    .single();

  if (error) {
    console.error("[graduation] Error fetching organization:", error);
    return null;
  }

  return data as OrgWithSlug;
}

/**
 * Get admin emails for an organization.
 */
export async function getOrgAdminEmails(
  supabase: SupabaseClient<Database>,
  orgId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .eq("status", "active");

  if (error || !data || data.length === 0) {
    return [];
  }

  const userIds = data.map((r) => r.user_id);

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("email")
    .in("id", userIds);

  if (usersError || !users) {
    return [];
  }

  return users.map((u) => u.email).filter((e): e is string => !!e);
}

/**
 * Check if organization has capacity for more alumni.
 * Returns { hasCapacity, currentCount, limit }.
 */
export async function checkAlumniCapacity(
  supabase: SupabaseClient<Database>,
  orgId: string
): Promise<{ hasCapacity: boolean; currentCount: number; limit: number | null }> {
  // Get organization's subscription to find alumni bucket
  const { data: subscription, error: subError } = await supabase
    .from("organization_subscriptions")
    .select("alumni_bucket")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (subError) {
    console.error("[graduation] Error fetching subscription:", subError);
    throw new Error(`Failed to check alumni capacity: ${subError.message}`);
  }

  // No subscription means no alumni capacity
  const alumniBucket = subscription?.alumni_bucket || "none";
  const limit = getAlumniLimit(alumniBucket as Parameters<typeof getAlumniLimit>[0]);

  // null limit means unlimited
  if (limit === null) {
    return { hasCapacity: true, currentCount: 0, limit: null };
  }

  // Count current alumni from the alumni table (source of truth for quota)
  const { count, error: countError } = await supabase
    .from("alumni")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("deleted_at", null);

  if (countError) {
    console.error("[graduation] Error counting alumni:", countError);
    return { hasCapacity: false, currentCount: 0, limit };
  }

  const currentCount = count || 0;

  // Cross-reference: also count from user_organization_roles for consistency check
  const { count: roleCount, error: roleCountError } = await supabase
    .from("user_organization_roles")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("role", "alumni")
    .eq("status", "active");

  const roleAlumniCount = roleCountError ? -1 : (roleCount || 0);

  if (!roleCountError && roleAlumniCount !== currentCount) {
    console.warn(
      `[graduation] ALUMNI COUNT MISMATCH: org=${maskPII(orgId)} alumni_table=${currentCount} roles_table=${roleAlumniCount}. ` +
      "The alumni table and user_organization_roles disagree. This may indicate a failed DB trigger (handle_org_member_sync)."
    );
  }

  debugLog("graduation", "checkAlumniCapacity", {
    orgId: maskPII(orgId),
    bucket: alumniBucket,
    limit,
    alumniTableCount: currentCount,
    rolesTableCount: roleAlumniCount,
    hasCapacity: currentCount < limit,
  });

  return { hasCapacity: currentCount < limit, currentCount, limit };
}

/**
 * Transition a member to alumni status via transactional RPC.
 *
 * The RPC atomically:
 * 1. Guards: skips admins, already-graduated, checks alumni quota
 * 2. Updates role to alumni in user_organization_roles
 * 3. Sets graduated_at on members row
 * 4. Copies graduation_year to alumni row
 */
export async function transitionToAlumni(
  supabase: SupabaseClient<Database>,
  memberId: string,
  userId: string,
  orgId: string
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  debugLog("graduation", "transitionToAlumni start", {
    memberId: maskPII(memberId),
    userId: maskPII(userId),
    orgId: maskPII(orgId),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("transition_member_to_alumni", {
    p_member_id: memberId,
    p_user_id: userId,
    p_org_id: orgId,
  });

  if (error) {
    debugLog("graduation", "transitionToAlumni RPC error", error.message);
    return { success: false, error: error.message };
  }

  const result = data as { success: boolean; skipped?: boolean; error?: string };
  debugLog("graduation", "transitionToAlumni result", result);
  return result;
}

/**
 * Revoke member access via transactional RPC when organization has no alumni capacity.
 *
 * The RPC atomically:
 * 1. Guards: skips admins, already-graduated
 * 2. Sets status to revoked on user_organization_roles
 * 3. Sets graduated_at on members row
 */
export async function revokeMemberAccess(
  supabase: SupabaseClient<Database>,
  memberId: string,
  userId: string,
  orgId: string
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("revoke_graduated_member", {
    p_member_id: memberId,
    p_user_id: userId,
    p_org_id: orgId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data as { success: boolean; skipped?: boolean; error?: string };
  return result;
}

/**
 * Mark warning as sent for a member.
 */
export async function markWarningSent(
  supabase: SupabaseClient<Database>,
  memberId: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("members") as any)
    .update({ graduation_warning_sent_at: new Date().toISOString() })
    .eq("id", memberId);

  if (error) {
    console.error("[graduation] Error marking warning sent:", error);
  }
}

/**
 * Reinstate a graduated alumni back to active member via transactional RPC.
 *
 * The RPC atomically:
 * 1. Guards: skips admins, already-active members
 * 2. Clears graduated_at and graduation_warning_sent_at
 * 3. Sets role to active_member with the given status
 * 4. Soft-deletes alumni record
 *
 * @param status - 'active' for cron-driven reinstatement (date moved forward),
 *                 'pending' for manual admin reinstatement via API
 */
export async function reinstateToActiveMember(
  supabase: SupabaseClient<Database>,
  memberId: string,
  userId: string,
  orgId: string,
  status: "active" | "pending" = "active"
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  debugLog("graduation", "reinstateToActiveMember start", {
    memberId: maskPII(memberId),
    userId: maskPII(userId),
    orgId: maskPII(orgId),
    status,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("reinstate_alumni_to_active", {
    p_member_id: memberId,
    p_user_id: userId,
    p_org_id: orgId,
    p_status: status,
  });

  if (error) {
    debugLog("graduation", "reinstateToActiveMember RPC error", error.message);
    return { success: false, error: error.message };
  }

  const result = data as { success: boolean; skipped?: boolean; error?: string };
  debugLog("graduation", "reinstateToActiveMember result", result);
  return result;
}

/**
 * Get graduated members whose expected_graduation_date has been moved to the future.
 * These members should be auto-reinstated back to active status.
 *
 * Criteria: graduated_at IS NOT NULL AND expected_graduation_date > today (strictly)
 * Date exactly today stays graduated (matches getMembersPastGraduation using lte).
 */
export async function getMembersToReinstate(
  supabase: SupabaseClient<Database>
): Promise<GraduatingMember[]> {
  const today = new Date().toISOString().split("T")[0];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = supabase.from("members") as any;
  const { data, error } = await query
    .select("id, user_id, first_name, last_name, email, organization_id, expected_graduation_date")
    .is("deleted_at", null)
    .not("graduated_at", "is", null)
    .not("expected_graduation_date", "is", null)
    .gt("expected_graduation_date", today);

  if (error) {
    console.error("[graduation] Error fetching members to reinstate:", error);
    throw error;
  }

  return (data || []) as GraduatingMember[];
}

/**
 * Dry-run result for the graduation cron job.
 */
export interface GraduationDryRunResult {
  toAlumni: GraduatingMember[];
  toRevoke: GraduatingMember[];
  toReinstate: GraduatingMember[];
  warnings: GraduatingMember[];
  capacityByOrg: Record<string, { hasCapacity: boolean; currentCount: number; limit: number | null }>;
}

/**
 * Preview what the graduation cron would do without writing anything.
 * Fetches all relevant member sets and capacity info in parallel.
 */
export async function getGraduationDryRun(
  supabase: SupabaseClient<Database>
): Promise<GraduationDryRunResult> {
  const [pastGraduation, toReinstate, warnings] = await Promise.all([
    getMembersPastGraduation(supabase),
    getMembersToReinstate(supabase),
    getMembersNearingGraduation(supabase, 30),
  ]);

  // Determine capacity per org for past-graduation members
  const orgIds = [...new Set(pastGraduation.map((m) => m.organization_id))];
  const capacityByOrg: Record<string, { hasCapacity: boolean; currentCount: number; limit: number | null }> = {};

  for (const orgId of orgIds) {
    capacityByOrg[orgId] = await checkAlumniCapacity(supabase, orgId);
  }

  const toAlumni: GraduatingMember[] = [];
  const toRevoke: GraduatingMember[] = [];

  for (const member of pastGraduation) {
    if (!member.user_id) continue;
    const capacity = capacityByOrg[member.organization_id];
    if (capacity?.hasCapacity) {
      toAlumni.push(member);
    } else {
      toRevoke.push(member);
    }
  }

  return { toAlumni, toRevoke, toReinstate, warnings, capacityByOrg };
}
