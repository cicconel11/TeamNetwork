import { ALUMNI_BUCKET_PRICING, ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";
import type { BillingInterval } from "@/types/enterprise";

/**
 * Get the alumni capacity for a given bucket quantity.
 * Each bucket covers 2,500 alumni.
 */
export function getAlumniBucketCapacity(bucketQuantity: number): number {
  return bucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;
}

/**
 * Get the minimum bucket quantity needed for a given alumni count.
 * Always returns at least 1 (alumni pricing is mandatory).
 */
export function getRequiredBucketQuantity(alumniCount: number): number {
  return Math.max(1, Math.ceil(alumniCount / ALUMNI_BUCKET_PRICING.capacityPerBucket));
}

/**
 * Check if a bucket quantity is self-serve (1-4) or sales-led (5+).
 */
export function isSalesLed(bucketQuantity: number): boolean {
  return bucketQuantity > ALUMNI_BUCKET_PRICING.maxSelfServeBuckets;
}

/**
 * Get alumni bucket pricing for a given quantity and interval.
 */
export function getAlumniBucketPricing(
  bucketQuantity: number,
  interval: BillingInterval
): { unitCents: number; totalCents: number; capacity: number } {
  const unitCents = interval === "month"
    ? ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket
    : ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket;

  return {
    unitCents,
    totalCents: bucketQuantity * unitCents,
    capacity: getAlumniBucketCapacity(bucketQuantity),
  };
}

/**
 * Calculate the number of billable organizations (those beyond the free tier).
 * First 3 organizations are included with any alumni bucket.
 */
export function getBillableOrgCount(totalOrgs: number): number {
  return Math.max(0, totalOrgs - ENTERPRISE_SEAT_PRICING.freeSubOrgs);
}

/**
 * Get sub-org add-on pricing for a given total org count and interval.
 */
export function getSubOrgPricing(
  totalOrgs: number,
  interval: BillingInterval
): {
  totalOrgs: number;
  freeOrgs: number;
  billableOrgs: number;
  unitCents: number;
  totalCents: number;
} {
  const billable = getBillableOrgCount(totalOrgs);
  const unitCents = interval === "month"
    ? ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly
    : ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;

  return {
    totalOrgs,
    freeOrgs: Math.min(totalOrgs, ENTERPRISE_SEAT_PRICING.freeSubOrgs),
    billableOrgs: billable,
    unitCents,
    totalCents: billable * unitCents,
  };
}

/**
 * Get combined enterprise pricing breakdown.
 *
 * Examples from pricing spec:
 *   3 teams, 2,500 alumni → $50/mo ($500/yr)
 *   5 teams, 5,000 alumni → $130/mo ($1,300/yr)
 *   8 teams, 10,000 alumni → $275/mo ($2,750/yr)
 */
export function getEnterpriseTotalPricing(
  alumniBucketQuantity: number,
  totalOrgs: number,
  interval: BillingInterval
): {
  alumni: ReturnType<typeof getAlumniBucketPricing>;
  subOrgs: ReturnType<typeof getSubOrgPricing>;
  totalCents: number;
} {
  const alumni = getAlumniBucketPricing(alumniBucketQuantity, interval);
  const subOrgs = getSubOrgPricing(totalOrgs, interval);

  return {
    alumni,
    subOrgs,
    totalCents: alumni.totalCents + subOrgs.totalCents,
  };
}

/**
 * Format a bucket quantity as a human-readable alumni range.
 */
export function formatBucketRange(bucketQuantity: number): string {
  if (bucketQuantity <= 0) return "0";
  const max = bucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;
  const min = (bucketQuantity - 1) * ALUMNI_BUCKET_PRICING.capacityPerBucket + 1;
  if (bucketQuantity === 1) return `0 - ${max.toLocaleString()}`;
  return `${min.toLocaleString()} - ${max.toLocaleString()}`;
}

/**
 * Format price in cents to dollars.
 */
export function formatSeatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
