import { cache } from "react";
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
  isParent: boolean;
  subscription: SubscriptionStatus | null;
  gracePeriod: GracePeriodInfo;
  hasAlumniAccess: boolean;
  hasParentsAccess: boolean;
};

/** Normalize a raw membership row into role + status. Shared by getOrgRole and getOrgContext. */
function normalizeMembershipRow(data: { role?: unknown; status?: unknown } | null): {
  role: OrgRole | null;
  status: MembershipStatus | null;
} {
  return {
    role: normalizeRole((data?.role as UserRole | null) ?? null),
    status: (data?.status as MembershipStatus | null) ?? null,
  };
}

/**
 * Cached wrapper for auth.getUser(). React.cache() deduplicates calls
 * within the same server request — layout + page calling this both
 * hit Supabase auth only once.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

export async function getOrgRole(params: { orgId: string; userId?: string }): Promise<OrgRoleResult> {
  let uid = params.userId ?? null;
  if (!uid) {
    const user = await getCurrentUser();
    if (!user) return { role: null, status: null, userId: null };
    uid = user.id;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("organization_id", params.orgId)
    .eq("user_id", uid)
    .maybeSingle();

  const { role, status } = normalizeMembershipRow(data);
  return { role, status, userId: uid };
}

export async function requireOrgRole(params: {
  orgId: string;
  allowedRoles: OrgRole[];
  redirectTo?: string;
}): Promise<OrgRoleResult> {
  const membership = await getOrgRole({ orgId: params.orgId, userId: undefined });
  const allowed =
    membership.role && membership.status === "active" && params.allowedRoles.includes(membership.role);

  if (!allowed) {
    if (params.redirectTo) {
      redirect(params.redirectTo);
    }
    throw new Error("Forbidden");
  }

  return membership;
}

/**
 * Main org context loader — cached per orgSlug within a single request.
 *
 * React.cache() deduplicates layout + page calls.
 * 2-stage parallel fetch:
 *   Stage 1: getCurrentUser() + org query (parallel, independent)
 *   Stage 2: subscription RPC + membership query (parallel, both need org.id)
 */
export const getOrgContext = cache(async (orgSlug: string): Promise<OrgContextResult> => {
  // Stage 1: user + org lookup in parallel (independent of each other)
  const supabase = await createClient();
  const [user, { data: org }] = await Promise.all([
    getCurrentUser(),
    supabase
      .from("organizations")
      .select(
        "id, name, slug, logo_url, primary_color, secondary_color, nav_config, stripe_connect_account_id, org_type, donation_embed_url, created_at, feed_post_roles, job_post_roles, discussion_post_roles, media_upload_roles"
      )
      .eq("slug", orgSlug)
      .maybeSingle(),
  ]);

  const userId = user?.id ?? null;

  if (!org) {
    const flags = roleFlags(null);
    return {
      organization: null as Organization | null,
      status: null as MembershipStatus | null,
      userId,
      subscription: null,
      gracePeriod: getGracePeriodInfo(null),
      hasAlumniAccess: false,
      hasParentsAccess: false,
      ...flags,
    };
  }

  // Stage 2: subscription + membership in parallel (both need org.id but not each other)
  const [{ data: subscriptionRows }, membershipData] = await Promise.all([
    supabase.rpc("get_subscription_status", { p_org_id: org.id }),
    userId
      ? supabase
          .from("user_organization_roles")
          .select("role,status")
          .eq("organization_id", org.id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const subscriptionData = subscriptionRows?.[0] ?? null;

  const subscription: SubscriptionStatus | null = subscriptionData
    ? {
        status: subscriptionData.status,
        gracePeriodEndsAt: subscriptionData.grace_period_ends_at,
        currentPeriodEnd: subscriptionData.current_period_end,
      }
    : null;

  const hasAlumniAccess =
    subscriptionData?.status === "enterprise_managed" ||
    (subscriptionData?.alumni_bucket != null && subscriptionData.alumni_bucket !== "none");

  const hasParentsAccess =
    subscriptionData?.status === "enterprise_managed" ||
    (subscriptionData?.parents_bucket != null && subscriptionData.parents_bucket !== "none");

  const gracePeriod = getGracePeriodInfo(subscription);

  const { role, status: memberStatus } = normalizeMembershipRow(membershipData?.data);
  const flags = memberStatus === "active" ? roleFlags(role) : roleFlags(null);

  return {
    organization: org as Organization,
    status: memberStatus,
    userId,
    subscription,
    gracePeriod,
    hasAlumniAccess,
    hasParentsAccess,
    ...flags,
  };
});

export { normalizeRole, roleFlags };
