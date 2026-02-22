import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MembershipStatus, Organization, UserRole } from "@/types/database";
import { normalizeRole, roleFlags, type OrgRole } from "./role-utils";
import { getGracePeriodInfo, type GracePeriodInfo, type SubscriptionStatus } from "@/lib/subscription/grace-period";

type OrgRoleResult = {
  role: OrgRole | null;
  status: MembershipStatus | null;
  userId: string | null;
};

export type OrgContextResult = {
  organization: Organization | null;
  status: MembershipStatus | null;
  userId: string | null;
  role: OrgRole | null;
  isAdmin: boolean;
  isActiveMember: boolean;
  isAlumni: boolean;
  subscription: SubscriptionStatus | null;
  gracePeriod: GracePeriodInfo;
};

export async function getOrgRole(params: { orgId: string; userId?: string }): Promise<OrgRoleResult> {
  const supabase = await createClient();
  let uid = params.userId ?? null;
  if (!uid) {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return { role: null, status: null, userId: null };
    uid = user.id;
  }

  const { data } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("organization_id", params.orgId)
    .eq("user_id", uid)
    .maybeSingle();

  const role = normalizeRole((data?.role as UserRole | null) ?? null);
  const status = (data?.status as MembershipStatus | null) ?? "active";

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

export async function getOrgContext(orgSlug: string): Promise<OrgContextResult> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  const userId = userError ? null : (user?.id ?? null);

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
      subscription: null,
      gracePeriod: getGracePeriodInfo(null),
      ...flags,
    };
  }

  // Fetch subscription status via security-definer RPC (exposes only safe columns,
  // works for all authenticated org members — not just admins)
  const { data: subscriptionRows } = await supabase
    .rpc("get_subscription_status", { p_org_id: org.id });
  const subscriptionData = subscriptionRows?.[0] ?? null;

  const subscription: SubscriptionStatus | null = subscriptionData
    ? {
        status: subscriptionData.status,
        gracePeriodEndsAt: subscriptionData.grace_period_ends_at,
        currentPeriodEnd: subscriptionData.current_period_end,
      }
    : null;

  const gracePeriod = getGracePeriodInfo(subscription);

  const membership = await getOrgRole({ orgId: org.id, userId: userId ?? undefined });
  const flags = roleFlags(membership.role);
  return {
    organization: org as Organization,
    status: membership.status,
    userId,
    subscription,
    gracePeriod,
    ...flags,
  };
}

export { normalizeRole, roleFlags };

