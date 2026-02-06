import { createServiceClient } from "@/lib/supabase/service";
import { getEnterpriseTierLimit } from "./pricing";
import type { EnterpriseTier } from "@/types/enterprise";

// Type for enterprise subscription row (until types regenerated)
interface EnterpriseSubscriptionRow {
  alumni_tier: string;
  pooled_alumni_limit: number | null;
}

// Type for seat-based subscription row (until types regenerated)
interface SeatSubscriptionRow {
  pricing_model: string | null;
  sub_org_quantity: number | null;
}

// Type for enterprise-managed org count from view
interface EnterpriseManagedCountRow {
  enterprise_managed_org_count: number;
}

// Type for enterprise alumni counts view (until types regenerated)
interface AlumniCountsRow {
  total_alumni_count: number;
  sub_org_count: number;
}

export interface EnterpriseQuotaInfo {
  allowed: boolean;
  tier: EnterpriseTier;
  alumniLimit: number | null;
  alumniCount: number;
  remaining: number | null;
  subOrgCount: number;
}

export interface SeatQuotaInfo {
  allowed: boolean;
  currentCount: number;  // enterprise-managed orgs only
  maxAllowed: number | null;  // sub_org_quantity (null = unlimited/legacy)
  needsUpgrade: boolean;
}

export async function getEnterpriseQuota(enterpriseId: string): Promise<EnterpriseQuotaInfo | null> {
  const supabase = createServiceClient();

  // Get subscription tier
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription } = await (supabase as any)
    .from("enterprise_subscriptions")
    .select("alumni_tier, pooled_alumni_limit")
    .eq("enterprise_id", enterpriseId)
    .single() as { data: EnterpriseSubscriptionRow | null };

  if (!subscription) return null;

  const tier = subscription.alumni_tier as EnterpriseTier;
  const limit = subscription.pooled_alumni_limit ?? getEnterpriseTierLimit(tier);

  // Get alumni count from view
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: counts } = await (supabase as any)
    .from("enterprise_alumni_counts")
    .select("total_alumni_count, sub_org_count")
    .eq("enterprise_id", enterpriseId)
    .single() as { data: AlumniCountsRow | null };

  const alumniCount = counts?.total_alumni_count ?? 0;
  const subOrgCount = counts?.sub_org_count ?? 0;

  return {
    allowed: true,
    tier,
    alumniLimit: limit,
    alumniCount,
    remaining: limit === null ? null : Math.max(limit - alumniCount, 0),
    subOrgCount,
  };
}

export async function canEnterpriseAddAlumni(enterpriseId: string, additionalCount: number = 1): Promise<boolean> {
  const quota = await getEnterpriseQuota(enterpriseId);
  if (!quota) return false;
  if (quota.alumniLimit === null) return true; // unlimited
  return quota.alumniCount + additionalCount <= quota.alumniLimit;
}

export async function checkAdoptionQuota(
  enterpriseId: string,
  orgId: string
): Promise<{ allowed: boolean; error?: string; wouldBeTotal?: number; limit?: number }> {
  const supabase = createServiceClient();

  const quota = await getEnterpriseQuota(enterpriseId);
  if (!quota) return { allowed: false, error: "Enterprise subscription not found" };

  // Get org's alumni count
  const { count: orgAlumniCount } = await supabase
    .from("alumni")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("deleted_at", null);

  const wouldBeTotal = quota.alumniCount + (orgAlumniCount ?? 0);

  if (quota.alumniLimit !== null && wouldBeTotal > quota.alumniLimit) {
    return {
      allowed: false,
      error: `Adoption would exceed alumni limit (${wouldBeTotal}/${quota.alumniLimit}). Upgrade to a higher tier first.`,
      wouldBeTotal,
      limit: quota.alumniLimit,
    };
  }

  return { allowed: true, wouldBeTotal, limit: quota.alumniLimit ?? undefined };
}

export async function canEnterpriseAddSubOrg(enterpriseId: string): Promise<SeatQuotaInfo> {
  const supabase = createServiceClient();

  // Get subscription with pricing model
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription } = await (supabase as any)
    .from("enterprise_subscriptions")
    .select("pricing_model, sub_org_quantity")
    .eq("enterprise_id", enterpriseId)
    .single() as { data: SeatSubscriptionRow | null };

  // If no seat-based pricing, no limit (legacy tier-based)
  if (!subscription || subscription.pricing_model !== "per_sub_org") {
    return { allowed: true, currentCount: 0, maxAllowed: null, needsUpgrade: false };
  }

  // Get current enterprise-managed org count from the view
  // Source of truth: organization_subscriptions.status = 'enterprise_managed'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: counts } = await (supabase as any)
    .from("enterprise_alumni_counts")
    .select("enterprise_managed_org_count")
    .eq("enterprise_id", enterpriseId)
    .single() as { data: EnterpriseManagedCountRow | null };

  const currentCount = counts?.enterprise_managed_org_count ?? 0;

  // per_sub_org model: unlimited orgs allowed, billing kicks in after free tier
  return {
    allowed: true,
    currentCount,
    maxAllowed: null,
    needsUpgrade: false,
  };
}
