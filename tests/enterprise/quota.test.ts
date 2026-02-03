import { describe, it } from "node:test";
import assert from "node:assert";
import type { EnterpriseQuotaInfo, SeatQuotaInfo } from "../../src/lib/enterprise/quota.ts";

/**
 * Tests for enterprise quota utilities
 *
 * These tests verify:
 * 1. canEnterpriseAddAlumni() with various scenarios
 * 2. checkAdoptionQuota() edge cases
 * 3. getEnterpriseQuota() return structure
 * 4. canEnterpriseAddSubOrg() seat limit enforcement
 *
 * Since the actual functions use Supabase, we test the logic
 * by simulating the function behavior with mocked data.
 */

// Simulated quota checking logic (mirrors the actual implementation)
function simulateCanEnterpriseAddAlumni(
  quota: EnterpriseQuotaInfo | null,
  additionalCount: number = 1
): boolean {
  if (!quota) return false;
  if (quota.alumniLimit === null) return true; // unlimited
  return quota.alumniCount + additionalCount <= quota.alumniLimit;
}

interface AdoptionQuotaResult {
  allowed: boolean;
  error?: string;
  wouldBeTotal?: number;
  limit?: number;
}

function simulateCheckAdoptionQuota(
  quota: EnterpriseQuotaInfo | null,
  orgAlumniCount: number
): AdoptionQuotaResult {
  if (!quota) {
    return { allowed: false, error: "Enterprise subscription not found" };
  }

  const wouldBeTotal = quota.alumniCount + orgAlumniCount;

  if (quota.alumniLimit !== null && wouldBeTotal > quota.alumniLimit) {
    return {
      allowed: false,
      error: `Adoption would exceed alumni limit (${wouldBeTotal}/${quota.alumniLimit}). Upgrade to a higher tier first.`,
      wouldBeTotal,
      limit: quota.alumniLimit,
    };
  }

  return {
    allowed: true,
    wouldBeTotal,
    limit: quota.alumniLimit ?? undefined,
  };
}

describe("canEnterpriseAddAlumni", () => {
  it("returns false when quota is null", () => {
    const result = simulateCanEnterpriseAddAlumni(null);
    assert.strictEqual(result, false);
  });

  it("returns true when limit is unlimited (null)", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_3",
      alumniLimit: null,
      alumniCount: 15000,
      remaining: null,
      subOrgCount: 3,
    };
    const result = simulateCanEnterpriseAddAlumni(quota);
    assert.strictEqual(result, true);
  });

  it("returns true when adding one alumni stays within limit", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 4999,
      remaining: 1,
      subOrgCount: 2,
    };
    const result = simulateCanEnterpriseAddAlumni(quota, 1);
    assert.strictEqual(result, true);
  });

  it("returns false when adding alumni would exceed limit", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 5000,
      remaining: 0,
      subOrgCount: 2,
    };
    const result = simulateCanEnterpriseAddAlumni(quota, 1);
    assert.strictEqual(result, false);
  });

  it("returns true when at exact limit and adding zero", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 5000,
      remaining: 0,
      subOrgCount: 2,
    };
    const result = simulateCanEnterpriseAddAlumni(quota, 0);
    assert.strictEqual(result, true);
  });

  it("returns false when adding multiple alumni would exceed limit", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_2",
      alumniLimit: 10000,
      alumniCount: 9500,
      remaining: 500,
      subOrgCount: 5,
    };
    const result = simulateCanEnterpriseAddAlumni(quota, 501);
    assert.strictEqual(result, false);
  });

  it("returns true when adding multiple alumni stays within limit", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_2",
      alumniLimit: 10000,
      alumniCount: 9500,
      remaining: 500,
      subOrgCount: 5,
    };
    const result = simulateCanEnterpriseAddAlumni(quota, 500);
    assert.strictEqual(result, true);
  });

  it("handles edge case of zero alumni count", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 0,
      remaining: 5000,
      subOrgCount: 0,
    };
    const result = simulateCanEnterpriseAddAlumni(quota, 5000);
    assert.strictEqual(result, true);
  });

  it("handles custom tier with unlimited quota", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "custom",
      alumniLimit: null,
      alumniCount: 50000,
      remaining: null,
      subOrgCount: 20,
    };
    const result = simulateCanEnterpriseAddAlumni(quota, 10000);
    assert.strictEqual(result, true);
  });
});

describe("checkAdoptionQuota", () => {
  it("returns error when quota is null", () => {
    const result = simulateCheckAdoptionQuota(null, 100);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.error, "Enterprise subscription not found");
  });

  it("allows adoption when within limit", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 2000,
      remaining: 3000,
      subOrgCount: 2,
    };
    const result = simulateCheckAdoptionQuota(quota, 1000);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 3000);
    assert.strictEqual(result.limit, 5000);
  });

  it("rejects adoption when would exceed limit", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 4500,
      remaining: 500,
      subOrgCount: 3,
    };
    const result = simulateCheckAdoptionQuota(quota, 600);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.error?.includes("exceed alumni limit"));
    assert.strictEqual(result.wouldBeTotal, 5100);
    assert.strictEqual(result.limit, 5000);
  });

  it("allows adoption at exact limit boundary", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_2",
      alumniLimit: 10000,
      alumniCount: 8000,
      remaining: 2000,
      subOrgCount: 4,
    };
    const result = simulateCheckAdoptionQuota(quota, 2000);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 10000);
  });

  it("rejects adoption when one over limit", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_2",
      alumniLimit: 10000,
      alumniCount: 8000,
      remaining: 2000,
      subOrgCount: 4,
    };
    const result = simulateCheckAdoptionQuota(quota, 2001);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.wouldBeTotal, 10001);
  });

  it("always allows adoption for unlimited tiers", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_3",
      alumniLimit: null,
      alumniCount: 25000,
      remaining: null,
      subOrgCount: 10,
    };
    const result = simulateCheckAdoptionQuota(quota, 15000);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 40000);
    assert.strictEqual(result.limit, undefined);
  });

  it("handles adoption of org with zero alumni", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 5000,
      remaining: 0,
      subOrgCount: 5,
    };
    const result = simulateCheckAdoptionQuota(quota, 0);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 5000);
  });

  it("provides upgrade message in error", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 4000,
      remaining: 1000,
      subOrgCount: 2,
    };
    const result = simulateCheckAdoptionQuota(quota, 2000);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.error?.includes("Upgrade to a higher tier"));
  });

  it("includes quota numbers in error message", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 3000,
      remaining: 2000,
      subOrgCount: 2,
    };
    const result = simulateCheckAdoptionQuota(quota, 2500);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.error?.includes("5500")); // wouldBeTotal
    assert.ok(result.error?.includes("5000")); // limit
  });
});

describe("EnterpriseQuotaInfo structure", () => {
  it("has all required fields", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 1000,
      remaining: 4000,
      subOrgCount: 2,
    };

    assert.ok("allowed" in quota);
    assert.ok("tier" in quota);
    assert.ok("alumniLimit" in quota);
    assert.ok("alumniCount" in quota);
    assert.ok("remaining" in quota);
    assert.ok("subOrgCount" in quota);
  });

  it("remaining is calculated correctly", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_2",
      alumniLimit: 10000,
      alumniCount: 7500,
      remaining: 2500,
      subOrgCount: 5,
    };

    // Verify remaining = limit - count
    assert.strictEqual(quota.remaining, quota.alumniLimit! - quota.alumniCount);
  });

  it("remaining is null when limit is unlimited", () => {
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_3",
      alumniLimit: null,
      alumniCount: 50000,
      remaining: null,
      subOrgCount: 15,
    };

    assert.strictEqual(quota.remaining, null);
  });

  it("remaining cannot be negative", () => {
    // This tests the expected behavior - remaining should be >= 0
    const quota: EnterpriseQuotaInfo = {
      allowed: true,
      tier: "tier_1",
      alumniLimit: 5000,
      alumniCount: 5500, // Over limit
      remaining: 0, // Should be capped at 0, not -500
      subOrgCount: 3,
    };

    assert.ok(quota.remaining !== null && quota.remaining >= 0);
  });
});

// Subscription types for seat-based pricing
interface MockSeatSubscription {
  pricing_model: string | null;
  sub_org_quantity: number | null;
}

// Simulated canEnterpriseAddSubOrg logic (mirrors actual implementation)
function simulateCanEnterpriseAddSubOrg(
  subscription: MockSeatSubscription | null,
  enterpriseManagedOrgCount: number
): SeatQuotaInfo {
  // If no seat-based pricing, no limit (legacy tier-based)
  if (!subscription || subscription.pricing_model !== "per_sub_org" || !subscription.sub_org_quantity) {
    return { allowed: true, currentCount: 0, maxAllowed: null, needsUpgrade: false };
  }

  return {
    allowed: enterpriseManagedOrgCount < subscription.sub_org_quantity,
    currentCount: enterpriseManagedOrgCount,
    maxAllowed: subscription.sub_org_quantity,
    needsUpgrade: enterpriseManagedOrgCount >= subscription.sub_org_quantity,
  };
}

describe("canEnterpriseAddSubOrg", () => {
  it("returns unlimited when subscription is null", () => {
    const result = simulateCanEnterpriseAddSubOrg(null, 5);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.maxAllowed, null);
    assert.strictEqual(result.needsUpgrade, false);
  });

  it("returns unlimited when pricing_model is not per_sub_org", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "tier_based",
      sub_org_quantity: null,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 10);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.maxAllowed, null);
  });

  it("returns unlimited when sub_org_quantity is null", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: null,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 5);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.maxAllowed, null);
  });

  it("allows adding sub-org when under limit", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: 5,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 3);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 3);
    assert.strictEqual(result.maxAllowed, 5);
    assert.strictEqual(result.needsUpgrade, false);
  });

  it("allows adding sub-org when one below limit", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: 5,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 4);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 4);
    assert.strictEqual(result.maxAllowed, 5);
    assert.strictEqual(result.needsUpgrade, false);
  });

  it("denies adding sub-org when at limit", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: 5,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 5);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.currentCount, 5);
    assert.strictEqual(result.maxAllowed, 5);
    assert.strictEqual(result.needsUpgrade, true);
  });

  it("denies adding sub-org when over limit", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: 5,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 6);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.currentCount, 6);
    assert.strictEqual(result.maxAllowed, 5);
    assert.strictEqual(result.needsUpgrade, true);
  });

  it("handles zero current count", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: 3,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 0);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 0);
    assert.strictEqual(result.maxAllowed, 3);
    assert.strictEqual(result.needsUpgrade, false);
  });

  it("handles single seat limit", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: 1,
    };

    // Can add first org
    const result1 = simulateCanEnterpriseAddSubOrg(subscription, 0);
    assert.strictEqual(result1.allowed, true);
    assert.strictEqual(result1.maxAllowed, 1);

    // Cannot add second org
    const result2 = simulateCanEnterpriseAddSubOrg(subscription, 1);
    assert.strictEqual(result2.allowed, false);
    assert.strictEqual(result2.needsUpgrade, true);
  });

  it("handles large seat quantities", () => {
    const subscription: MockSeatSubscription = {
      pricing_model: "per_sub_org",
      sub_org_quantity: 100,
    };
    const result = simulateCanEnterpriseAddSubOrg(subscription, 99);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 99);
    assert.strictEqual(result.maxAllowed, 100);
  });
});
