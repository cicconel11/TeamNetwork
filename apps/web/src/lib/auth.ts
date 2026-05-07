import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import { normalizeRole } from "./auth/role-utils";

// Re-export the cached version from roles.ts — all callers get deduplication
export { getCurrentUser } from "./auth/roles";

export async function getUserProfile() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
}

export async function getUserRoleForOrg(organizationId: string): Promise<UserRole | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data, error: roleError } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (roleError) {
    throw new Error(`[getUserRoleForOrg] DB query failed: ${roleError.message}`);
  }

  if (!data || data.status === "revoked") return null;

  return normalizeRole((data.role as UserRole | null) || null);
}

export async function isOrgAdmin(organizationId: string): Promise<boolean> {
  const role = await getUserRoleForOrg(organizationId);
  return role === "admin";
}

export async function isOrgMember(organizationId: string): Promise<boolean> {
  const role = await getUserRoleForOrg(organizationId);
  return role !== null;
}

