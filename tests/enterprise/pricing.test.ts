import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getEnterpriseTierLimit,
  getEnterprisePricing,
  getRequiredTierForAlumniCount,
  formatTierName,
  ENTERPRISE_TIER_LIMITS,
  ENTERPRISE_TIER_PRICING,
} from "../../src/lib/enterprise/pricing.ts";
import type { EnterpriseTier, BillingInterval } from "../../src/types/enterprise.ts";

/**
 * Tests for enterprise pricing utilities
 *
 * These tests verify:
 * 1. getEnterpriseTierLimit() returns correct limits for each tier
 * 2. getEnterprisePricing() returns correct pricing
 * 3. getRequiredTierForAlumniCount() returns correct tier based on count
 * 4. formatTierName() formats correctly
 */

describe("getEnterpriseTierLimit", () => {
  it("returns 5000 for tier_1", () => {
    const limit = getEnterpriseTierLimit("tier_1");
    assert.strictEqual(limit, 5000);
  });

  it("returns 10000 for tier_2", () => {
    const limit = getEnterpriseTierLimit("tier_2");
    assert.strictEqual(limit, 10000);
  });

  it("returns null (unlimited) for tier_3", () => {
    const limit = getEnterpriseTierLimit("tier_3");
    assert.strictEqual(limit, null);
  });

  it("returns null (unlimited) for custom", () => {
    const limit = getEnterpriseTierLimit("custom");
    assert.strictEqual(limit, null);
  });

  it("returns default (5000) for null tier", () => {
    const limit = getEnterpriseTierLimit(null);
    assert.strictEqual(limit, 5000);
  });

  it("returns default (5000) for undefined tier", () => {
    const limit = getEnterpriseTierLimit(undefined);
    assert.strictEqual(limit, 5000);
  });

  it("returns default (5000) for invalid tier", () => {
    const limit = getEnterpriseTierLimit("invalid_tier" as EnterpriseTier);
    assert.strictEqual(limit, 5000);
  });
});

describe("getEnterprisePricing", () => {
  it("returns monthly pricing for tier_1", () => {
    const price = getEnterprisePricing("tier_1", "month");
    assert.strictEqual(price, 10000); // $100.00 in cents
  });

  it("returns yearly pricing for tier_1", () => {
    const price = getEnterprisePricing("tier_1", "year");
    assert.strictEqual(price, 100000); // $1000.00 in cents
  });

  it("returns monthly pricing for tier_2", () => {
    const price = getEnterprisePricing("tier_2", "month");
    assert.strictEqual(price, 15000); // $150.00 in cents
  });

  it("returns yearly pricing for tier_2", () => {
    const price = getEnterprisePricing("tier_2", "year");
    assert.strictEqual(price, 150000); // $1500.00 in cents
  });

  it("returns null for tier_3 (custom pricing)", () => {
    const monthlyPrice = getEnterprisePricing("tier_3", "month");
    const yearlyPrice = getEnterprisePricing("tier_3", "year");
    assert.strictEqual(monthlyPrice, null);
    assert.strictEqual(yearlyPrice, null);
  });

  it("returns null for custom tier (custom pricing)", () => {
    const monthlyPrice = getEnterprisePricing("custom", "month");
    const yearlyPrice = getEnterprisePricing("custom", "year");
    assert.strictEqual(monthlyPrice, null);
    assert.strictEqual(yearlyPrice, null);
  });

  it("handles all valid billing intervals", () => {
    const intervals: BillingInterval[] = ["month", "year"];
    for (const interval of intervals) {
      const price = getEnterprisePricing("tier_1", interval);
      assert.ok(typeof price === "number", `Should return number for ${interval}`);
    }
  });
});

describe("getRequiredTierForAlumniCount", () => {
  it("returns tier_1 for 0 alumni", () => {
    const tier = getRequiredTierForAlumniCount(0);
    assert.strictEqual(tier, "tier_1");
  });

  it("returns tier_1 for exactly 5000 alumni", () => {
    const tier = getRequiredTierForAlumniCount(5000);
    assert.strictEqual(tier, "tier_1");
  });

  it("returns tier_1 for alumni count under 5000", () => {
    const tier = getRequiredTierForAlumniCount(2500);
    assert.strictEqual(tier, "tier_1");
  });

  it("returns tier_2 for 5001 alumni", () => {
    const tier = getRequiredTierForAlumniCount(5001);
    assert.strictEqual(tier, "tier_2");
  });

  it("returns tier_2 for exactly 10000 alumni", () => {
    const tier = getRequiredTierForAlumniCount(10000);
    assert.strictEqual(tier, "tier_2");
  });

  it("returns tier_2 for alumni count between 5001 and 10000", () => {
    const tier = getRequiredTierForAlumniCount(7500);
    assert.strictEqual(tier, "tier_2");
  });

  it("returns tier_3 for 10001 alumni", () => {
    const tier = getRequiredTierForAlumniCount(10001);
    assert.strictEqual(tier, "tier_3");
  });

  it("returns tier_3 for very large alumni count", () => {
    const tier = getRequiredTierForAlumniCount(50000);
    assert.strictEqual(tier, "tier_3");
  });

  it("handles boundary values correctly", () => {
    assert.strictEqual(getRequiredTierForAlumniCount(4999), "tier_1");
    assert.strictEqual(getRequiredTierForAlumniCount(5000), "tier_1");
    assert.strictEqual(getRequiredTierForAlumniCount(5001), "tier_2");
    assert.strictEqual(getRequiredTierForAlumniCount(9999), "tier_2");
    assert.strictEqual(getRequiredTierForAlumniCount(10000), "tier_2");
    assert.strictEqual(getRequiredTierForAlumniCount(10001), "tier_3");
  });
});

describe("formatTierName", () => {
  it("formats tier_1 correctly", () => {
    const name = formatTierName("tier_1");
    assert.strictEqual(name, "Tier 1 (Up to 5,000 alumni)");
  });

  it("formats tier_2 correctly", () => {
    const name = formatTierName("tier_2");
    assert.strictEqual(name, "Tier 2 (Up to 10,000 alumni)");
  });

  it("formats tier_3 correctly", () => {
    const name = formatTierName("tier_3");
    assert.strictEqual(name, "Tier 3 (Unlimited alumni)");
  });

  it("formats custom correctly", () => {
    const name = formatTierName("custom");
    assert.strictEqual(name, "Custom Plan");
  });

  it("includes alumni count information in display name", () => {
    const tier1Name = formatTierName("tier_1");
    const tier2Name = formatTierName("tier_2");
    const tier3Name = formatTierName("tier_3");

    assert.ok(tier1Name.includes("5,000"));
    assert.ok(tier2Name.includes("10,000"));
    assert.ok(tier3Name.toLowerCase().includes("unlimited"));
  });
});

describe("ENTERPRISE_TIER_LIMITS constant", () => {
  it("contains all tier keys", () => {
    const tiers: EnterpriseTier[] = ["tier_1", "tier_2", "tier_3", "custom"];
    for (const tier of tiers) {
      assert.ok(tier in ENTERPRISE_TIER_LIMITS, `Missing tier: ${tier}`);
    }
  });

  it("has correct values", () => {
    assert.strictEqual(ENTERPRISE_TIER_LIMITS.tier_1, 5000);
    assert.strictEqual(ENTERPRISE_TIER_LIMITS.tier_2, 10000);
    assert.strictEqual(ENTERPRISE_TIER_LIMITS.tier_3, null);
    assert.strictEqual(ENTERPRISE_TIER_LIMITS.custom, null);
  });
});

describe("ENTERPRISE_TIER_PRICING constant", () => {
  it("contains all tier keys", () => {
    const tiers: EnterpriseTier[] = ["tier_1", "tier_2", "tier_3", "custom"];
    for (const tier of tiers) {
      assert.ok(tier in ENTERPRISE_TIER_PRICING, `Missing tier: ${tier}`);
    }
  });

  it("has correct structure for priced tiers", () => {
    const tier1 = ENTERPRISE_TIER_PRICING.tier_1;
    const tier2 = ENTERPRISE_TIER_PRICING.tier_2;

    assert.ok(tier1 !== null && "monthly" in tier1 && "yearly" in tier1);
    assert.ok(tier2 !== null && "monthly" in tier2 && "yearly" in tier2);
  });

  it("has null for custom pricing tiers", () => {
    assert.strictEqual(ENTERPRISE_TIER_PRICING.tier_3, null);
    assert.strictEqual(ENTERPRISE_TIER_PRICING.custom, null);
  });

  it("yearly pricing is approximately 10x monthly for tier_1", () => {
    const tier1 = ENTERPRISE_TIER_PRICING.tier_1;
    if (tier1) {
      assert.strictEqual(tier1.yearly, tier1.monthly * 10);
    }
  });

  it("yearly pricing is approximately 10x monthly for tier_2", () => {
    const tier2 = ENTERPRISE_TIER_PRICING.tier_2;
    if (tier2) {
      assert.strictEqual(tier2.yearly, tier2.monthly * 10);
    }
  });
});
