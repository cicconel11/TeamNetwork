import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getUserProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
}

export async function getUserRoleForOrg(organizationId: string): Promise<UserRole | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return null;

  const { data } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  return data?.role || null;
}

export async function isOrgAdmin(organizationId: string): Promise<boolean> {
  const role = await getUserRoleForOrg(organizationId);
  return role === "admin";
}

export async function isOrgMember(organizationId: string): Promise<boolean> {
  const role = await getUserRoleForOrg(organizationId);
  return role !== null;
}

