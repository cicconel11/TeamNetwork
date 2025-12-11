import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MembershipStatus, Organization, UserRole } from "@/types/database";
import { normalizeRole, roleFlags, type OrgRole } from "./role-utils";

type OrgRoleResult = {
  role: OrgRole | null;
  status: MembershipStatus | null;
  userId: string | null;
};

export async function getOrgRole(params: { orgId: string; userId?: string }): Promise<OrgRoleResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const uid = params.userId ?? session?.user?.id ?? null;
  if (!uid) {
    return { role: null, status: null, userId: null };
  }

  const { data } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("organization_id", params.orgId)
    .eq("user_id", uid)
    .maybeSingle();

  const role = normalizeRole((data?.role as UserRole | null) ?? null);
  const status = (data?.status as MembershipStatus | null) ?? null;

  return { role, status, userId: uid };
}

export async function requireOrgRole(params: {
  orgId: string;
  allowedRoles: OrgRole[];
  redirectTo?: string;
}): Promise<OrgRoleResult> {
  const membership = await getOrgRole({ orgId: params.orgId, userId: undefined });
  const allowed =
    membership.role && membership.status !== "revoked" && params.allowedRoles.includes(membership.role);

  if (!allowed) {
    if (params.redirectTo) {
      redirect(params.redirectTo);
    }
    throw new Error("Forbidden");
  }

  return membership;
}

export async function getOrgContext(orgSlug: string) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .maybeSingle();

  if (!org) {
    const flags = roleFlags(null);
    return {
      organization: null as Organization | null,
      status: null as MembershipStatus | null,
      userId,
      ...flags,
    };
  }

  const membership = await getOrgRole({ orgId: org.id, userId: userId ?? undefined });
  const flags = roleFlags(membership.role);
  return {
    organization: org as Organization,
    status: membership.status,
    userId,
    ...flags,
  };
}

export { normalizeRole, roleFlags };

