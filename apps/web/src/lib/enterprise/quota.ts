import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database";
import {
  buildQuotaInfo,
  checkAlumniCapacity,
  evaluateAdoptionQuota,
  evaluateSubOrgCapacity,
  batchQuotaCheck,
} from "./quota-logic";

// Re-export pure functions and types for consumers
export {
  buildQuotaInfo,
  checkAlumniCapacity,
  evaluateAdoptionQuota,
  evaluateSubOrgCapacity,
  batchQuotaCheck,
} from "./quota-logic";
export type {
  EnterpriseQuotaInfo,
  SeatQuotaInfo,
  AdoptionQuotaResult,
} from "./quota-logic";

type EnterpriseSubscriptionRow = Pick<Tables<"enterprise_subscriptions">, "alumni_bucket_quantity">;

// Type for enterprise counts from RPC
interface EnterpriseCountsResult {
  total_alumni_count: number;
  sub_org_count: number;
  enterprise_managed_org_count: number;
  sub_org_quantity: number | null;
}


/**
 * Fetch enterprise counts using the parameterized function (preferred)
 * or fall back to the VIEW if the function isn't available yet.
 */
async function fetchEnterpriseCounts(
  enterpriseId: string
): Promise<EnterpriseCountsResult | null> {
  const supabase = createServiceClient();

  // Use the parameterized function for efficient per-enterprise query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("get_enterprise_counts", {
    p_enterprise_id: enterpriseId,
  }) as { data: EnterpriseCountsResult | null; error: unknown };

  if (error) {
    console.error("[enterprise-quota] get_enterprise_counts RPC failed, falling back to view:", error);
    // Fallback to the view
    return fetchEnterpriseCountsFromView(enterpriseId);
  }

  return data;
}

/**
 * Fallback: fetch from the enterprise_alumni_counts VIEW.
 */
async function fetchEnterpriseCountsFromView(
  enterpriseId: string
): Promise<EnterpriseCountsResult | null> {
  const supabase = createServiceClient();

  const [
    { data: counts, error: countsError },
    { data: subscription, error: subError },
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("enterprise_alumni_counts")
      .select("total_alumni_count, sub_org_count, enterprise_managed_org_count")
      .eq("enterprise_id", enterpriseId)
      .single() as Promise<{
        data: { total_alumni_count: number; sub_org_count: number; enterprise_managed_org_count: number } | null;
        error: unknown;
      }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("enterprise_subscriptions")
      .select("sub_org_quantity")
      .eq("enterprise_id", enterpriseId)
      .single() as Promise<{ data: { sub_org_quantity: number | null } | null; error: unknown }>,
  ]);

  if (countsError || subError) {
    console.error("[enterprise-quota] view fallback failed:", countsError || subError);
    return null;
  }

  return {
    total_alumni_count: counts?.total_alumni_count ?? 0,
    sub_org_count: counts?.sub_org_count ?? 0,
    enterprise_managed_org_count: counts?.enterprise_managed_org_count ?? 0,
    sub_org_quantity: subscription?.sub_org_quantity ?? null,
  };
}

// ── Async Wrappers (fetch data from Supabase, delegate to pure functions) ──

export async function getEnterpriseQuota(enterpriseId: string) {
  const supabase = createServiceClient();

  // Fetch subscription and counts in parallel
  const [{ data: subscription, error: subscriptionError }, counts] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("enterprise_subscriptions")
      .select("alumni_bucket_quantity")
      .eq("enterprise_id", enterpriseId)
      .single() as Promise<{ data: EnterpriseSubscriptionRow | null; error: unknown }>,
    fetchEnterpriseCounts(enterpriseId),
  ]);

  if (subscriptionError) {
    console.error("[enterprise-quota] Failed to fetch enterprise subscription:", subscriptionError);
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
  const counts = await fetchEnterpriseCounts(enterpriseId);

  if (!counts) {
    return { currentCount: 0, maxAllowed: null as number | null, error: "internal_error" };
  }

  return evaluateSubOrgCapacity(
    counts.enterprise_managed_org_count,
    counts.sub_org_quantity
  );
}

/**
 * Batch-aware sub-org quota check.
 * Returns whether `count` new orgs can be added within the hard cap.
 */
export async function canEnterpriseAddSubOrgs(
  enterpriseId: string,
  count: number
) {
  const counts = await fetchEnterpriseCounts(enterpriseId);

  if (!counts) {
    return {
      allowed: false,
      remaining: null as number | null,
      wouldExceedBy: 0,
      currentCount: 0,
      maxAllowed: null as number | null,
      error: "internal_error",
    };
  }

  const check = batchQuotaCheck(
    counts.enterprise_managed_org_count,
    counts.sub_org_quantity,
    count
  );

  return {
    ...check,
    currentCount: counts.enterprise_managed_org_count,
    maxAllowed: counts.sub_org_quantity,
  };
}
