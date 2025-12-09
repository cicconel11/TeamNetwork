import { createClient } from "@/lib/supabase/client";

export async function checkIsOrgAdmin(orgSlug: string): Promise<boolean> {
  const supabase = createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // Get org
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return false;

  // Check role
  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", org.id)
    .single();

  return role?.role === "admin";
}


