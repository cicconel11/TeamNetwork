import { createServiceClient } from "@/lib/supabase/service";
import {
  buildQuotaInfo,
  checkAlumniCapacity,
  evaluateAdoptionQuota,
  evaluateSubOrgCapacity,
} from "./quota-logic";

// Re-export pure functions and types for consumers
export {
  buildQuotaInfo,
  checkAlumniCapacity,
  evaluateAdoptionQuota,
  evaluateSubOrgCapacity,
} from "./quota-logic";
export type {
  EnterpriseQuotaInfo,
  SeatQuotaInfo,
  AdoptionQuotaResult,
} from "./quota-logic";

// Type for enterprise subscription row (until types regenerated)
interface EnterpriseSubscriptionRow {
  alumni_bucket_quantity: number;
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

// ── Async Wrappers (fetch data from Supabase, delegate to pure functions) ──

export async function getEnterpriseQuota(enterpriseId: string) {
  const supabase = createServiceClient();

  // Fetch subscription and alumni counts in parallel (both only need enterpriseId)
  const [{ data: subscription, error: subscriptionError }, { data: counts, error: countsError }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("enterprise_subscriptions")
      .select("alumni_bucket_quantity")
      .eq("enterprise_id", enterpriseId)
      .single() as Promise<{ data: EnterpriseSubscriptionRow | null; error: unknown }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("enterprise_alumni_counts")
      .select("total_alumni_count, sub_org_count")
      .eq("enterprise_id", enterpriseId)
      .single() as Promise<{ data: AlumniCountsRow | null; error: unknown }>,
  ]);

  if (subscriptionError) {
    console.error("[enterprise-quota] Failed to fetch enterprise subscription:", subscriptionError);
    return null;
  }

  if (countsError) {
    console.error("[enterprise-quota] Failed to fetch enterprise alumni counts:", countsError);
    return null;
  }

  if (!subscription) return null;

  const alumniCount = counts?.total_alumni_count ?? 0;
  const subOrgCount = counts?.sub_org_count ?? 0;

  return buildQuotaInfo(subscription.alumni_bucket_quantity, alumniCount, subOrgCount);
}

export async function canEnterpriseAddAlumni(enterpriseId: string, additionalCount: number = 1): Promise<boolean> {
  const quota = await getEnterpriseQuota(enterpriseId);
  return checkAlumniCapacity(quota, additionalCount);
}

export async function checkAdoptionQuota(
  enterpriseId: string,
  orgId: string
) {
  const supabase = createServiceClient();

  const quota = await getEnterpriseQuota(enterpriseId);
  if (!quota) return { allowed: false as const, error: "Enterprise subscription not found" };

  // Get org's alumni count
  const { count: orgAlumniCount, error: alumniCountError } = await supabase
    .from("alumni")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .is("deleted_at", null);

  if (alumniCountError) {
    console.error("[enterprise-quota] Failed to fetch org alumni count:", alumniCountError);
    return { allowed: false as const, error: "Failed to verify alumni count", status: 503 };
  }

  return evaluateAdoptionQuota(quota, orgAlumniCount ?? 0);
}

export async function canEnterpriseAddSubOrg(enterpriseId: string) {
  const supabase = createServiceClient();

  // Get current enterprise-managed org count from the view
  // Source of truth: organization_subscriptions.status = 'enterprise_managed'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: counts, error: countsError } = await (supabase as any)
    .from("enterprise_alumni_counts")
    .select("enterprise_managed_org_count")
    .eq("enterprise_id", enterpriseId)
    .single() as { data: EnterpriseManagedCountRow | null; error: unknown };

  if (countsError) {
    console.error("[enterprise-quota] Failed to fetch enterprise managed org count:", countsError);
    return { currentCount: 0, maxAllowed: null, error: "internal_error" };
  }

  const currentCount = counts?.enterprise_managed_org_count ?? 0;

  return evaluateSubOrgCapacity(currentCount);
}
