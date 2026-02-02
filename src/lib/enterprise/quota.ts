import { createServiceClient } from "@/lib/supabase/service";
import { getEnterpriseTierLimit } from "./pricing";
import type { EnterpriseTier } from "@/types/enterprise";

// Type for enterprise subscription row (until types regenerated)
interface EnterpriseSubscriptionRow {
  alumni_tier: string;
  pooled_alumni_limit: number | null;
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
