import type { EnterpriseTier, BillingInterval } from "@/types/enterprise";
import { ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";

export const ENTERPRISE_TIER_LIMITS: Record<EnterpriseTier, number | null> = {
  tier_1: 5000,
  tier_2: 10000,
  tier_3: null,
  custom: null,
};

export const ENTERPRISE_TIER_PRICING: Record<EnterpriseTier, { monthly: number; yearly: number } | null> = {
  tier_1: { monthly: 10000, yearly: 100000 },
  tier_2: { monthly: 15000, yearly: 150000 },
  tier_3: null,
  custom: null,
};

export function getEnterpriseTierLimit(tier: EnterpriseTier | null | undefined): number | null {
  if (!tier || !(tier in ENTERPRISE_TIER_LIMITS)) return 5000; // default to tier_1
  return ENTERPRISE_TIER_LIMITS[tier];
}

export function getEnterprisePricing(tier: EnterpriseTier, interval: BillingInterval): number | null {
  const pricing = ENTERPRISE_TIER_PRICING[tier];
  if (!pricing) return null;
  return interval === "month" ? pricing.monthly : pricing.yearly;
}

export function getRequiredTierForAlumniCount(count: number): EnterpriseTier {
  if (count <= 5000) return "tier_1";
  if (count <= 10000) return "tier_2";
  return "tier_3";
}

export function formatTierName(tier: EnterpriseTier): string {
  switch (tier) {
    case "tier_1": return "Tier 1 (Up to 5,000 alumni)";
    case "tier_2": return "Tier 2 (Up to 10,000 alumni)";
    case "tier_3": return "Tier 3 (Unlimited alumni)";
    case "custom": return "Custom Plan";
  }
}

/**
 * Calculate the number of billable organizations (those beyond the free tier).
 * First 5 organizations are free.
 */
export function getBillableOrgCount(totalOrgs: number): number {
  return Math.max(0, totalOrgs - ENTERPRISE_SEAT_PRICING.freeSubOrgs);
}

/**
 * Get detailed pricing breakdown for enterprise sub-org pricing.
 * First 5 orgs are free, then $150/year for each additional org.
 */
export function getEnterpriseSubOrgPricing(totalOrgs: number): {
  totalOrgs: number;
  freeOrgs: number;
  billableOrgs: number;
  totalCentsYearly: number;
} {
  const billable = getBillableOrgCount(totalOrgs);
  return {
    totalOrgs,
    freeOrgs: Math.min(totalOrgs, ENTERPRISE_SEAT_PRICING.freeSubOrgs),
    billableOrgs: billable,
    totalCentsYearly: billable * ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly,
  };
}

/**
 * Legacy function - kept for compatibility but now simplified.
 * Returns yearly pricing since that's the only billing interval for the new model.
 */
export function getEnterpriseQuantityPricing(
  quantity: number,
  interval: BillingInterval
): { unitPrice: number; total: number; savings?: number } {
  // With the new free tier model, billing is yearly-only
  // quantity represents TOTAL orgs, billable = quantity - 5
  const billable = getBillableOrgCount(quantity);
  const yearlyUnitPrice = ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;

  // Always return yearly pricing (monthly interval is deprecated)
  if (interval === "year" || interval === "month") {
    return {
      unitPrice: yearlyUnitPrice,
      total: billable * yearlyUnitPrice,
    };
  }

  return {
    unitPrice: yearlyUnitPrice,
    total: billable * yearlyUnitPrice,
  };
}

export function formatSeatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
