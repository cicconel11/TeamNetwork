import type { AlumniBucket } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { getEnterpriseTierLimit } from "@/lib/enterprise/pricing";
import type { EnterpriseTier } from "@/types/enterprise";

export const ALUMNI_LIMITS: Record<AlumniBucket, number | null> = {
  none: 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

export function getAlumniLimit(bucket: AlumniBucket | null | undefined) {
  if (!bucket || !(bucket in ALUMNI_LIMITS)) return 0;
  return ALUMNI_LIMITS[bucket];
}

export function normalizeBucket(bucket: string | null | undefined): AlumniBucket {
  const allowed: AlumniBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"];
  return allowed.includes(bucket as AlumniBucket) ? (bucket as AlumniBucket) : "none";
}

// Type for org with enterprise_id (until types are regenerated)
interface OrgWithEnterprise {
  enterprise_id: string | null;
}

// Type for enterprise subscription (until types are regenerated)
interface EnterpriseSubscriptionRow {
  alumni_tier: string;
  pooled_alumni_limit: number | null;
}

/**
 * Checks if an organization belongs to an enterprise.
 * @param orgId - The organization ID to check
 * @returns true if the org has an enterprise_id, false otherwise
 */
export async function isOrgEnterpriseManaged(orgId: string): Promise<boolean> {
  const supabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (supabase as any)
    .from("organizations")
    .select("enterprise_id")
    .eq("id", orgId)
    .single() as { data: OrgWithEnterprise | null };

  return org?.enterprise_id != null;
}

/**
 * Gets the alumni limit for an organization, accounting for enterprise pooling.
 * If the org belongs to an enterprise, returns the enterprise's pooled limit.
 * Otherwise, returns the org's individual subscription limit.
 * @param orgId - The organization ID
 * @returns The alumni limit (null means unlimited), or 0 if no subscription found
 */
export async function getAlumniLimitForOrg(orgId: string): Promise<number | null> {
  const supabase = createServiceClient();

  // Get org with enterprise info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (supabase as any)
    .from("organizations")
    .select("enterprise_id")
    .eq("id", orgId)
    .single() as { data: OrgWithEnterprise | null };

  if (!org) {
    return 0;
  }

  // If org belongs to an enterprise, use enterprise pooled limit
  if (org.enterprise_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: subscription } = await (supabase as any)
      .from("enterprise_subscriptions")
      .select("alumni_tier, pooled_alumni_limit")
      .eq("enterprise_id", org.enterprise_id)
      .single() as { data: EnterpriseSubscriptionRow | null };

    if (!subscription) {
      return 0;
    }

    // Use custom pooled limit if set, otherwise use tier limit
    if (subscription.pooled_alumni_limit != null) {
      return subscription.pooled_alumni_limit;
    }

    return getEnterpriseTierLimit(subscription.alumni_tier as EnterpriseTier);
  }

  // Otherwise, use org's individual subscription
  const { data: orgSub } = await supabase
    .from("organization_subscriptions")
    .select("alumni_quota_tier")
    .eq("organization_id", orgId)
    .maybeSingle() as { data: { alumni_quota_tier: string | null } | null };

  if (!orgSub) {
    return 0;
  }

  return getAlumniLimit(normalizeBucket(orgSub.alumni_quota_tier));
}
