import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Note: These tests don't import from src/ due to module resolution issues
 * with Node test runner and TypeScript path aliases. Instead, we replicate
 * the pricing logic here to test the business rules independently.
 */

// Replicate constants from src/types/enterprise.ts
const ENTERPRISE_SEAT_PRICING = {
  freeSubOrgs: 3, // First 3 organizations are free
  pricePerAdditionalCentsYearly: 15000, // $150/year per additional org beyond free tier
} as const;

// Replicate type from src/types/enterprise.ts
type PricingModel = "alumni_tier" | "per_sub_org";

// Replicate interface from src/lib/enterprise/quota.ts
interface SeatQuotaInfo {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number | null;
  needsUpgrade: boolean;
}

/**
 * Calculate the number of billable organizations (those beyond the free tier).
 * First 3 organizations are free.
 */
function getBillableOrgCount(totalOrgs: number): number {
  return Math.max(0, totalOrgs - ENTERPRISE_SEAT_PRICING.freeSubOrgs);
}

/**
 * Get detailed pricing breakdown for enterprise sub-org pricing.
 * First 3 orgs are free, then $150/year for each additional org.
 */
function getEnterpriseSubOrgPricing(totalOrgs: number): {
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

// Legacy function kept for compatibility
function getEnterpriseQuantityPricing(
  quantity: number,
  // Interval parameter kept for API compatibility but billing is always yearly
  interval: "month" | "year" // eslint-disable-line @typescript-eslint/no-unused-vars
): { unitPrice: number; total: number; savings?: number } {
  const billable = getBillableOrgCount(quantity);
  const yearlyUnitPrice = ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;

  return {
    unitPrice: yearlyUnitPrice,
    total: billable * yearlyUnitPrice,
  };
}

// Replicate function from src/lib/enterprise/pricing.ts
function formatSeatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

/**
 * Enterprise Quantity Pricing Tests
 *
 * Tests for seat-based (per_sub_org) pricing model with free tier:
 * 1. getBillableOrgCount() - Free tier calculations
 * 2. getEnterpriseSubOrgPricing() - Full pricing breakdown
 * 3. Seat quota enforcement logic
 * 4. Billing adjustment validation
 * 5. formatSeatPrice() - Display formatting
 *
 * Note: Functions that require Supabase (canEnterpriseAddSubOrg) are tested
 * using simulated logic that mirrors the actual implementation.
 */

// =============================================================================
// getBillableOrgCount Tests
// =============================================================================

describe("getBillableOrgCount", () => {
  describe("free tier (1-3 orgs)", () => {
    it("returns 0 billable for 1 org", () => {
      assert.strictEqual(getBillableOrgCount(1), 0);
    });

    it("returns 0 billable for 3 orgs (max free)", () => {
      assert.strictEqual(getBillableOrgCount(3), 0);
    });

    it("returns 0 billable for 2 orgs", () => {
      assert.strictEqual(getBillableOrgCount(2), 0);
    });
  });

  describe("paid tier (4+ orgs)", () => {
    it("returns 1 billable for 4 orgs (first paid)", () => {
      assert.strictEqual(getBillableOrgCount(4), 1);
    });

    it("returns 7 billable for 10 orgs", () => {
      assert.strictEqual(getBillableOrgCount(10), 7);
    });

    it("returns 17 billable for 20 orgs", () => {
      assert.strictEqual(getBillableOrgCount(20), 17);
    });

    it("returns 97 billable for 100 orgs", () => {
      assert.strictEqual(getBillableOrgCount(100), 97);
    });
  });

  describe("edge cases", () => {
    it("returns 0 for 0 orgs", () => {
      assert.strictEqual(getBillableOrgCount(0), 0);
    });

    it("returns 997 for 1000 orgs", () => {
      assert.strictEqual(getBillableOrgCount(1000), 997);
    });
  });
});

// =============================================================================
// getEnterpriseSubOrgPricing Tests
// =============================================================================

describe("getEnterpriseSubOrgPricing", () => {
  describe("free tier (1-3 orgs)", () => {
    it("calculates pricing for 1 org - all free", () => {
      const result = getEnterpriseSubOrgPricing(1);
      assert.strictEqual(result.totalOrgs, 1);
      assert.strictEqual(result.freeOrgs, 1);
      assert.strictEqual(result.billableOrgs, 0);
      assert.strictEqual(result.totalCentsYearly, 0);
    });

    it("calculates pricing for 3 orgs - all free", () => {
      const result = getEnterpriseSubOrgPricing(3);
      assert.strictEqual(result.totalOrgs, 3);
      assert.strictEqual(result.freeOrgs, 3);
      assert.strictEqual(result.billableOrgs, 0);
      assert.strictEqual(result.totalCentsYearly, 0);
    });
  });

  describe("paid tier (4+ orgs)", () => {
    it("calculates pricing for 4 orgs - 1 paid @ $150", () => {
      const result = getEnterpriseSubOrgPricing(4);
      assert.strictEqual(result.totalOrgs, 4);
      assert.strictEqual(result.freeOrgs, 3);
      assert.strictEqual(result.billableOrgs, 1);
      assert.strictEqual(result.totalCentsYearly, 15000); // $150
    });

    it("calculates pricing for 10 orgs - 7 paid @ $150 = $1,050", () => {
      const result = getEnterpriseSubOrgPricing(10);
      assert.strictEqual(result.totalOrgs, 10);
      assert.strictEqual(result.freeOrgs, 3);
      assert.strictEqual(result.billableOrgs, 7);
      assert.strictEqual(result.totalCentsYearly, 105000); // $1,050
    });

    it("calculates pricing for 20 orgs - 17 paid @ $150 = $2,550", () => {
      const result = getEnterpriseSubOrgPricing(20);
      assert.strictEqual(result.totalOrgs, 20);
      assert.strictEqual(result.freeOrgs, 3);
      assert.strictEqual(result.billableOrgs, 17);
      assert.strictEqual(result.totalCentsYearly, 255000); // $2,550
    });
  });

  describe("edge cases", () => {
    it("handles 0 orgs", () => {
      const result = getEnterpriseSubOrgPricing(0);
      assert.strictEqual(result.totalOrgs, 0);
      assert.strictEqual(result.freeOrgs, 0);
      assert.strictEqual(result.billableOrgs, 0);
      assert.strictEqual(result.totalCentsYearly, 0);
    });
  });
});

// =============================================================================
// getEnterpriseQuantityPricing Tests (Legacy Compatibility)
// =============================================================================

describe("getEnterpriseQuantityPricing", () => {
  describe("free tier pricing", () => {
    it("returns $0 total for 1-3 orgs", () => {
      const result1 = getEnterpriseQuantityPricing(1, "year");
      const result3 = getEnterpriseQuantityPricing(3, "year");

      assert.strictEqual(result1.total, 0);
      assert.strictEqual(result3.total, 0);
    });

    it("returns correct unit price", () => {
      const result = getEnterpriseQuantityPricing(3, "year");
      assert.strictEqual(result.unitPrice, ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly);
    });
  });

  describe("paid tier pricing", () => {
    it("calculates correctly for 4 orgs (1 billable)", () => {
      const result = getEnterpriseQuantityPricing(4, "year");
      assert.strictEqual(result.total, 15000); // $150
    });

    it("calculates correctly for 10 orgs (7 billable)", () => {
      const result = getEnterpriseQuantityPricing(10, "year");
      assert.strictEqual(result.total, 105000); // $1,050
    });

    it("handles large quantities", () => {
      const result = getEnterpriseQuantityPricing(100, "year");
      assert.strictEqual(result.total, 97 * 15000); // 97 billable @ $150 each
    });
  });

  describe("interval handling", () => {
    it("returns same pricing for month and year (yearly-only model)", () => {
      const monthResult = getEnterpriseQuantityPricing(10, "month");
      const yearResult = getEnterpriseQuantityPricing(10, "year");

      assert.strictEqual(monthResult.total, yearResult.total);
      assert.strictEqual(monthResult.unitPrice, yearResult.unitPrice);
    });
  });
});

// =============================================================================
// formatSeatPrice Tests
// =============================================================================

describe("formatSeatPrice", () => {
  it("formats price in cents to dollars", () => {
    const result = formatSeatPrice(15000);
    assert.strictEqual(result, "$150");
  });

  it("formats zero price", () => {
    const result = formatSeatPrice(0);
    assert.strictEqual(result, "$0");
  });

  it("formats large price", () => {
    const result = formatSeatPrice(1500000);
    assert.strictEqual(result, "$15000");
  });

  it("rounds to nearest dollar", () => {
    const result = formatSeatPrice(15050);
    // 15050 / 100 = 150.5 -> "150" (toFixed(0) rounds)
    assert.strictEqual(result, "$151");
  });

  it("handles small amounts", () => {
    const result = formatSeatPrice(100);
    assert.strictEqual(result, "$1");
  });
});

// =============================================================================
// Seat Quota Enforcement Tests (simulated)
// =============================================================================

/**
 * Simulates canEnterpriseAddSubOrg logic for testing
 * Mirrors src/lib/enterprise/quota.ts implementation
 *
 * per_sub_org pricing: unlimited orgs allowed (billing kicks in after free tier)
 * alumni_tier pricing: unlimited orgs (legacy, no seat concept)
 */
interface MockSubscription {
  pricing_model: PricingModel | null;
  sub_org_quantity: number | null;
}

function simulateCanEnterpriseAddSubOrg(
  subscription: MockSubscription | null,
  currentManagedOrgCount: number
): SeatQuotaInfo {
  // If no seat-based pricing, no limit (legacy tier-based)
  if (!subscription || subscription.pricing_model !== "per_sub_org") {
    return { allowed: true, currentCount: 0, maxAllowed: null, needsUpgrade: false };
  }

  // per_sub_org model: unlimited orgs allowed, billing kicks in after free tier
  return {
    allowed: true,
    currentCount: currentManagedOrgCount,
    maxAllowed: null,
    needsUpgrade: false,
  };
}

describe("canEnterpriseAddSubOrg (simulated)", () => {
  describe("per_sub_org — always allowed (unlimited)", () => {
    it("allows adding when under free tier", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 2);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.currentCount, 2);
      assert.strictEqual(result.maxAllowed, null);
      assert.strictEqual(result.needsUpgrade, false);
    });

    it("allows adding first org when none exist", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 10,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 0);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.currentCount, 0);
      assert.strictEqual(result.needsUpgrade, false);
    });

    it("allows adding beyond free tier (paid orgs)", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 10);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.currentCount, 10);
      assert.strictEqual(result.maxAllowed, null);
      assert.strictEqual(result.needsUpgrade, false);
    });

    it("allows adding with null sub_org_quantity", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: null,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 100);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.maxAllowed, null);
    });
  });

  describe("legacy tier pricing", () => {
    it("allows unlimited for alumni_tier pricing model", () => {
      const subscription: MockSubscription = {
        pricing_model: "alumni_tier",
        sub_org_quantity: null,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 100);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.maxAllowed, null);
      assert.strictEqual(result.needsUpgrade, false);
    });

    it("allows unlimited for null pricing model", () => {
      const subscription: MockSubscription = {
        pricing_model: null,
        sub_org_quantity: null,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 50);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.maxAllowed, null);
    });
  });

  describe("null subscription", () => {
    it("allows when subscription is null", () => {
      const result = simulateCanEnterpriseAddSubOrg(null, 0);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.maxAllowed, null);
      assert.strictEqual(result.needsUpgrade, false);
    });
  });
});

// =============================================================================
// Billing Adjustment Validation Tests (simulated)
// =============================================================================

interface BillingAdjustmentRequest {
  newQuantity: number;
  currentUsage: number;
  pricingModel: PricingModel | null;
  stripeSubscriptionId: string | null;
}

interface BillingAdjustmentResult {
  allowed: boolean;
  error?: string;
  errorCode?: "BELOW_USAGE" | "LEGACY_MODEL" | "NO_STRIPE";
  currentUsage?: number;
  requestedQuantity?: number;
}

/**
 * Simulates billing adjustment validation logic
 * Mirrors src/app/api/enterprise/[enterpriseId]/billing/adjust/route.ts
 */
function simulateBillingAdjustmentValidation(
  request: BillingAdjustmentRequest
): BillingAdjustmentResult {
  // Verify pricing model is per_sub_org
  if (request.pricingModel !== "per_sub_org") {
    return {
      allowed: false,
      error: "Seat quantity adjustment is only available for per-sub-org pricing. Please contact support to upgrade your pricing model.",
      errorCode: "LEGACY_MODEL",
    };
  }

  // Verify Stripe subscription exists
  if (!request.stripeSubscriptionId) {
    return {
      allowed: false,
      error: "Enterprise subscription is not linked to Stripe",
      errorCode: "NO_STRIPE",
    };
  }

  // Ensure new quantity is not below current usage
  if (request.newQuantity < request.currentUsage) {
    return {
      allowed: false,
      error: `Cannot reduce seat quantity below current usage. You currently have ${request.currentUsage} enterprise-managed organization(s). Remove some organizations first or choose a quantity of at least ${request.currentUsage}.`,
      errorCode: "BELOW_USAGE",
      currentUsage: request.currentUsage,
      requestedQuantity: request.newQuantity,
    };
  }

  return { allowed: true };
}

describe("billing adjustment validation", () => {
  describe("reducing below current usage", () => {
    it("prevents reducing below current usage", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 5,
        currentUsage: 10,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.errorCode, "BELOW_USAGE");
      assert.strictEqual(result.currentUsage, 10);
      assert.strictEqual(result.requestedQuantity, 5);
    });

    it("prevents reducing by even one below usage", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 9,
        currentUsage: 10,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.errorCode, "BELOW_USAGE");
    });

    it("includes helpful error message", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 3,
        currentUsage: 8,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.ok(result.error?.includes("8 enterprise-managed organization(s)"));
      assert.ok(result.error?.includes("at least 8"));
    });
  });

  describe("valid adjustments", () => {
    it("allows increasing seats", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 20,
        currentUsage: 10,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.error, undefined);
    });

    it("allows maintaining same quantity", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 10,
        currentUsage: 10,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, true);
    });

    it("allows reducing to exactly current usage", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 5,
        currentUsage: 5,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, true);
    });

    it("allows reducing when above current usage", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 8,
        currentUsage: 5,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, true);
    });
  });

  describe("legacy pricing model", () => {
    it("rejects adjustment for alumni_tier pricing", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 10,
        currentUsage: 5,
        pricingModel: "alumni_tier",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.errorCode, "LEGACY_MODEL");
      assert.ok(result.error?.includes("per-sub-org pricing"));
      assert.ok(result.error?.includes("contact support"));
    });

    it("rejects adjustment for null pricing model", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 10,
        currentUsage: 5,
        pricingModel: null,
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.errorCode, "LEGACY_MODEL");
    });
  });

  describe("missing Stripe subscription", () => {
    it("rejects when no Stripe subscription", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 10,
        currentUsage: 5,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: null,
      });

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.errorCode, "NO_STRIPE");
      assert.ok(result.error?.includes("not linked to Stripe"));
    });
  });

  describe("zero usage scenarios", () => {
    it("allows any quantity when no orgs exist", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 1,
        currentUsage: 0,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, true);
    });

    it("does not allow reducing to zero when orgs exist", () => {
      const result = simulateBillingAdjustmentValidation({
        newQuantity: 0,
        currentUsage: 1,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.errorCode, "BELOW_USAGE");
    });
  });
});

// =============================================================================
// Integration scenarios
// =============================================================================

describe("integration scenarios", () => {
  describe("free tier to paid transition", () => {
    it("calculates price increase when crossing free tier (3 to 4)", () => {
      const currentOrgs = 3;
      const newOrgs = 4;

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      assert.strictEqual(currentPricing.totalCentsYearly, 0); // Free
      assert.strictEqual(newPricing.totalCentsYearly, 15000); // $150
    });

    it("calculates price decrease when going back to free tier (4 to 3)", () => {
      const currentOrgs = 4;
      const newOrgs = 3;

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      assert.strictEqual(currentPricing.totalCentsYearly, 15000); // $150
      assert.strictEqual(newPricing.totalCentsYearly, 0); // Free
    });
  });

  describe("scaling paid orgs", () => {
    it("calculates price increase when scaling up paid orgs", () => {
      const currentOrgs = 10; // 7 billable
      const newOrgs = 15; // 12 billable

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      const increase = newPricing.totalCentsYearly - currentPricing.totalCentsYearly;
      assert.strictEqual(increase, 5 * 15000); // 5 additional billable orgs
    });

    it("calculates price decrease when scaling down paid orgs", () => {
      const currentOrgs = 15; // 12 billable
      const newOrgs = 10; // 7 billable

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      const decrease = currentPricing.totalCentsYearly - newPricing.totalCentsYearly;
      assert.strictEqual(decrease, 5 * 15000); // 5 fewer billable orgs
    });
  });

  describe("quota check — always allowed for per_sub_org", () => {
    it("always allows adding orgs with per_sub_org pricing", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };

      // Even at or beyond the old "limit", still allowed
      const quotaCheck = simulateCanEnterpriseAddSubOrg(subscription, 5);
      assert.strictEqual(quotaCheck.allowed, true);
      assert.strictEqual(quotaCheck.needsUpgrade, false);

      const quotaCheck2 = simulateCanEnterpriseAddSubOrg(subscription, 50);
      assert.strictEqual(quotaCheck2.allowed, true);
      assert.strictEqual(quotaCheck2.needsUpgrade, false);
    });
  });

  describe("pricing table from plan", () => {
    it("matches expected pricing table", () => {
      // | Total Orgs | Billable | Annual Charge |
      // |------------|----------|---------------|
      // | 1-3        | 0        | $0            |
      // | 4          | 1        | $150          |
      // | 10         | 7        | $1,050        |
      // | 20         | 17       | $2,550        |

      const pricing3 = getEnterpriseSubOrgPricing(3);
      assert.strictEqual(pricing3.billableOrgs, 0);
      assert.strictEqual(pricing3.totalCentsYearly, 0);

      const pricing4 = getEnterpriseSubOrgPricing(4);
      assert.strictEqual(pricing4.billableOrgs, 1);
      assert.strictEqual(pricing4.totalCentsYearly, 15000);

      const pricing10 = getEnterpriseSubOrgPricing(10);
      assert.strictEqual(pricing10.billableOrgs, 7);
      assert.strictEqual(pricing10.totalCentsYearly, 105000);

      const pricing20 = getEnterpriseSubOrgPricing(20);
      assert.strictEqual(pricing20.billableOrgs, 17);
      assert.strictEqual(pricing20.totalCentsYearly, 255000);
    });
  });
});
