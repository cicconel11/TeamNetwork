import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";

/**
 * Pure computation functions for enterprise quota checks.
 * No I/O dependencies — safe to import in test environments.
 *
 * The async wrappers in quota.ts fetch data from Supabase and
 * delegate to these functions for the actual logic.
 */

export interface EnterpriseQuotaInfo {
  bucketQuantity: number;
  alumniLimit: number;
  alumniCount: number;
  remaining: number;
  subOrgCount: number;
}

export interface SeatQuotaInfo {
  currentCount: number;  // enterprise-managed orgs only
  maxAllowed: number | null;  // sub_org_quantity (null = unlimited/legacy)
  error?: string;  // present only on DB/infra failure
}

export interface AdoptionQuotaResult {
  allowed: boolean;
  error?: string;
  status?: number;
  wouldBeTotal?: number;
  limit?: number;
}

/**
 * Build an EnterpriseQuotaInfo from raw data.
 * Pure function — no I/O, no side effects.
 */
export function buildQuotaInfo(
  bucketQuantity: number,
  alumniCount: number,
  subOrgCount: number
): EnterpriseQuotaInfo {
  const limit = bucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;
  return {
    bucketQuantity,
    alumniLimit: limit,
    alumniCount,
    remaining: Math.max(limit - alumniCount, 0),
    subOrgCount,
  };
}

/**
 * Check whether additional alumni can be added within the bucket capacity.
 * Pure function — operates on pre-fetched quota data.
 */
export function checkAlumniCapacity(
  quota: EnterpriseQuotaInfo | null,
  additionalCount: number = 1
): boolean {
  if (!quota) return false;
  return quota.alumniCount + additionalCount <= quota.alumniLimit;
}

/**
 * Evaluate whether adopting an org would exceed the alumni quota.
 * Pure function — operates on pre-fetched quota data.
 */
export function evaluateAdoptionQuota(
  quota: EnterpriseQuotaInfo | null,
  orgAlumniCount: number
): AdoptionQuotaResult {
  if (!quota) {
    return { allowed: false, error: "Enterprise subscription not found" };
  }

  const wouldBeTotal = quota.alumniCount + orgAlumniCount;

  if (wouldBeTotal > quota.alumniLimit) {
    return {
      allowed: false,
      error: `Adoption would exceed alumni limit (${wouldBeTotal}/${quota.alumniLimit}). Upgrade your alumni bucket first.`,
      wouldBeTotal,
      limit: quota.alumniLimit,
    };
  }

  return { allowed: true, wouldBeTotal, limit: quota.alumniLimit };
}

/**
 * Evaluate sub-org capacity. In the hybrid model, creation is always allowed
 * — billing kicks in after the free tier, but there is no hard cap.
 * Pure function — no I/O required.
 */
export function evaluateSubOrgCapacity(
  enterpriseManagedOrgCount: number
): SeatQuotaInfo {
  return {
    currentCount: enterpriseManagedOrgCount,
    maxAllowed: null,
  };
}

/**
 * Resolve the current sub-org quantity for billing seat adjustments.
 *
 * When `sub_org_quantity` is null (legacy subscriptions that pre-date the
 * hybrid pricing rollout), fall back to the larger of:
 *   - the free-tier baseline (ENTERPRISE_SEAT_PRICING.freeSubOrgs = 3)
 *   - the actual number of sub-orgs currently in the enterprise
 *
 * This prevents the client from sending `newQuantity = 1` when the real
 * starting point is "at least 3" (the free tier) or higher.
 *
 * Pure function — safe for both server and client use.
 *
 * @param rawQuantity   The `sub_org_quantity` value from the subscription row
 *                      (may be null or undefined for legacy records)
 * @param subOrgCount   The number of sub-orgs currently attached to the enterprise
 * @param freeBaseline  The minimum quantity before billing kicks in (default: 3)
 */
export function resolveCurrentQuantity(
  rawQuantity: number | null | undefined,
  subOrgCount: number,
  freeBaseline: number = 3
): number {
  if (rawQuantity != null) {
    return rawQuantity;
  }
  return Math.max(freeBaseline, subOrgCount);
}
