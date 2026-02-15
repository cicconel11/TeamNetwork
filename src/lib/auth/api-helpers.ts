import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Check if a user is an active member of an organization and return their role.
 * For use in API routes. Returns null if not a member.
 * Throws on DB query failure (callers already wrap in try/catch).
 */
export async function getOrgMembership(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string
): Promise<{ role: string } | null> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check org membership: ${error.message}`);
  }

  return data;
}
