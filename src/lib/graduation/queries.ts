import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAlumniLimit } from "@/lib/alumni-quota";

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

  // Count current alumni
  const { count, error: countError } = await supabase
    .from("user_organization_roles")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("role", "alumni")
    .eq("status", "active");

  if (countError) {
    console.error("[graduation] Error counting alumni:", countError);
    return { hasCapacity: false, currentCount: 0, limit };
  }

  const currentCount = count || 0;
  return { hasCapacity: currentCount < limit, currentCount, limit };
}

/**
 * Transition a member to alumni status.
 */
export async function transitionToAlumni(
  supabase: SupabaseClient<Database>,
  memberId: string,
  userId: string,
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  // Update user_organization_roles to alumni
  const { error: roleError } = await supabase
    .from("user_organization_roles")
    .update({ role: "alumni" })
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  if (roleError) {
    return { success: false, error: roleError.message };
  }

  // Mark member as graduated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: memberError } = await (supabase.from("members") as any)
    .update({ graduated_at: new Date().toISOString() })
    .eq("id", memberId);

  if (memberError) {
    return { success: false, error: memberError.message };
  }

  return { success: true };
}

/**
 * Revoke member access when organization has no alumni capacity.
 */
export async function revokeMemberAccess(
  supabase: SupabaseClient<Database>,
  memberId: string,
  userId: string,
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  // Update user_organization_roles to revoked
  const { error: roleError } = await supabase
    .from("user_organization_roles")
    .update({ status: "revoked" })
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  if (roleError) {
    return { success: false, error: roleError.message };
  }

  // Mark member as graduated (even though access was revoked)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: memberError } = await (supabase.from("members") as any)
    .update({ graduated_at: new Date().toISOString() })
    .eq("id", memberId);

  if (memberError) {
    return { success: false, error: memberError.message };
  }

  return { success: true };
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
