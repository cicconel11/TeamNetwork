import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";

export interface MemberWithUser {
  id: string;
  user_id: string;
  role: string;
  status: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

export interface FetchMembersResult {
  data: MemberWithUser[] | null;
  error: Error | null;
}

/**
 * Fetches active members of an organization with their user details
 */
export async function fetchOrganizationMembers(
  supabase: SupabaseClient<Database>,
  organizationId: string
): Promise<FetchMembersResult> {
  try {
    const { data, error } = await supabase
      .from("user_organization_roles")
      .select(`
        id,
        user_id,
        role,
        status,
        user:users(id, email, name, avatar_url)
      `)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("role", ["admin", "active_member", "member"])
      .order("role", { ascending: true });

    if (error) throw error;
    return { data: data as unknown as MemberWithUser[], error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}

/**
 * Fetches a user's role in an organization
 */
export async function fetchUserRoleInOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  userId: string
): Promise<{ data: { role: string; status: string } | null; error: Error | null }> {
  try {
    const { data, error } = await supabase
      .from("user_organization_roles")
      .select("role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}
