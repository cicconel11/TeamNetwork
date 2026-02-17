import { createClient } from "@/lib/supabase/server";
import type { EnterpriseRole, EnterpriseRolePermissions } from "@/types/enterprise";
import { getEnterprisePermissions } from "@/types/enterprise";

export async function getEnterpriseRole(
  enterpriseId: string,
  userId?: string
): Promise<EnterpriseRole | null> {
  const supabase = await createClient();
  const resolvedUserId = userId ?? (await supabase.auth.getUser()).data.user?.id;

  if (!resolvedUserId) return null;

  const { data } = await supabase
    .from("user_enterprise_roles")
    .select("role")
    .eq("enterprise_id", enterpriseId)
    .eq("user_id", resolvedUserId)
    .single();

  return data?.role as EnterpriseRole | null;
}

export async function requireEnterpriseRole(
  enterpriseId: string,
  allowedRoles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"]
): Promise<{ role: EnterpriseRole; userId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const role = await getEnterpriseRole(enterpriseId, user.id);

  if (!role || !allowedRoles.includes(role)) {
    throw new Error("Forbidden");
  }

  return { role, userId: user.id };
}

export async function requireEnterpriseOwner(enterpriseId: string): Promise<string> {
  const { userId } = await requireEnterpriseRole(enterpriseId, ["owner"]);
  return userId;
}

export async function requireEnterpriseBillingAccess(enterpriseId: string): Promise<string> {
  const { userId } = await requireEnterpriseRole(enterpriseId, ["owner", "billing_admin"]);
  return userId;
}

export async function getEnterpriseRolePermissions(enterpriseId: string): Promise<EnterpriseRolePermissions | null> {
  const role = await getEnterpriseRole(enterpriseId);
  if (!role) return null;
  return getEnterprisePermissions(role);
}
