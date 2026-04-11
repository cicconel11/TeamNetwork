import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Returns the user's active org role, or null if not a member.
 * Centralises the membership check duplicated across parent route handlers.
 * Throws on DB error so callers 500 rather than silently denying access.
 */
export async function getOrgMemberRole(
  supabase: SupabaseClient<Database>,
  userId: string,
  organizationId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(`[getOrgMemberRole] DB query failed: ${error.message}`);
  }

  return data?.role ?? null;
}
