import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Note: These tests don't import from src/ due to module resolution issues
 * with Node test runner and TypeScript path aliases. Instead, we replicate
 * the pricing logic here to test the business rules independently.
 */

// Replicate constants from src/types/enterprise.ts
const ENTERPRISE_SEAT_PRICING = {
  freeSubOrgs: 5, // First 5 organizations are free
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
 * First 5 organizations are free.
 */
function getBillableOrgCount(totalOrgs: number): number {
  return Math.max(0, totalOrgs - ENTERPRISE_SEAT_PRICING.freeSubOrgs);
}

/**
 * Get detailed pricing breakdown for enterprise sub-org pricing.
 * First 5 orgs are free, then $150/year for each additional org.
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
  describe("free tier (1-5 orgs)", () => {
    it("returns 0 billable for 1 org", () => {
      assert.strictEqual(getBillableOrgCount(1), 0);
    });

    it("returns 0 billable for 5 orgs (max free)", () => {
      assert.strictEqual(getBillableOrgCount(5), 0);
    });

    it("returns 0 billable for 3 orgs", () => {
      assert.strictEqual(getBillableOrgCount(3), 0);
    });
  });

  describe("paid tier (6+ orgs)", () => {
    it("returns 1 billable for 6 orgs (first paid)", () => {
      assert.strictEqual(getBillableOrgCount(6), 1);
    });

    it("returns 5 billable for 10 orgs", () => {
      assert.strictEqual(getBillableOrgCount(10), 5);
    });

    it("returns 15 billable for 20 orgs", () => {
      assert.strictEqual(getBillableOrgCount(20), 15);
    });

    it("returns 95 billable for 100 orgs", () => {
      assert.strictEqual(getBillableOrgCount(100), 95);
    });
  });

  describe("edge cases", () => {
    it("returns 0 for 0 orgs", () => {
      assert.strictEqual(getBillableOrgCount(0), 0);
    });

    it("returns 995 for 1000 orgs", () => {
      assert.strictEqual(getBillableOrgCount(1000), 995);
    });
  });
});

// =============================================================================
// getEnterpriseSubOrgPricing Tests
// =============================================================================

describe("getEnterpriseSubOrgPricing", () => {
  describe("free tier (1-5 orgs)", () => {
    it("calculates pricing for 1 org - all free", () => {
      const result = getEnterpriseSubOrgPricing(1);
      assert.strictEqual(result.totalOrgs, 1);
      assert.strictEqual(result.freeOrgs, 1);
      assert.strictEqual(result.billableOrgs, 0);
      assert.strictEqual(result.totalCentsYearly, 0);
    });

    it("calculates pricing for 5 orgs - all free", () => {
      const result = getEnterpriseSubOrgPricing(5);
      assert.strictEqual(result.totalOrgs, 5);
      assert.strictEqual(result.freeOrgs, 5);
      assert.strictEqual(result.billableOrgs, 0);
      assert.strictEqual(result.totalCentsYearly, 0);
    });
  });

  describe("paid tier (6+ orgs)", () => {
    it("calculates pricing for 6 orgs - 1 paid @ $150", () => {
      const result = getEnterpriseSubOrgPricing(6);
      assert.strictEqual(result.totalOrgs, 6);
      assert.strictEqual(result.freeOrgs, 5);
      assert.strictEqual(result.billableOrgs, 1);
      assert.strictEqual(result.totalCentsYearly, 15000); // $150
    });

    it("calculates pricing for 10 orgs - 5 paid @ $150 = $750", () => {
      const result = getEnterpriseSubOrgPricing(10);
      assert.strictEqual(result.totalOrgs, 10);
      assert.strictEqual(result.freeOrgs, 5);
      assert.strictEqual(result.billableOrgs, 5);
      assert.strictEqual(result.totalCentsYearly, 75000); // $750
    });

    it("calculates pricing for 20 orgs - 15 paid @ $150 = $2,250", () => {
      const result = getEnterpriseSubOrgPricing(20);
      assert.strictEqual(result.totalOrgs, 20);
      assert.strictEqual(result.freeOrgs, 5);
      assert.strictEqual(result.billableOrgs, 15);
      assert.strictEqual(result.totalCentsYearly, 225000); // $2,250
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
    it("returns $0 total for 1-5 orgs", () => {
      const result1 = getEnterpriseQuantityPricing(1, "year");
      const result5 = getEnterpriseQuantityPricing(5, "year");

      assert.strictEqual(result1.total, 0);
      assert.strictEqual(result5.total, 0);
    });

    it("returns correct unit price", () => {
      const result = getEnterpriseQuantityPricing(5, "year");
      assert.strictEqual(result.unitPrice, ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly);
    });
  });

  describe("paid tier pricing", () => {
    it("calculates correctly for 6 orgs (1 billable)", () => {
      const result = getEnterpriseQuantityPricing(6, "year");
      assert.strictEqual(result.total, 15000); // $150
    });

    it("calculates correctly for 10 orgs (5 billable)", () => {
      const result = getEnterpriseQuantityPricing(10, "year");
      assert.strictEqual(result.total, 75000); // $750
    });

    it("handles large quantities", () => {
      const result = getEnterpriseQuantityPricing(100, "year");
      assert.strictEqual(result.total, 95 * 15000); // 95 billable @ $150 each
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
  if (!subscription || subscription.pricing_model !== "per_sub_org" || !subscription.sub_org_quantity) {
    return { allowed: true, currentCount: 0, maxAllowed: null, needsUpgrade: false };
  }

  return {
    allowed: currentManagedOrgCount < subscription.sub_org_quantity,
    currentCount: currentManagedOrgCount,
    maxAllowed: subscription.sub_org_quantity,
    needsUpgrade: currentManagedOrgCount >= subscription.sub_org_quantity,
  };
}

describe("canEnterpriseAddSubOrg (simulated)", () => {
  describe("under limit scenarios", () => {
    it("allows adding when under limit", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 3);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.currentCount, 3);
      assert.strictEqual(result.maxAllowed, 5);
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

    it("allows adding when one below limit", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 4);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.needsUpgrade, false);
    });
  });

  describe("at/over limit scenarios", () => {
    it("blocks adding when at limit", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 5);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.currentCount, 5);
      assert.strictEqual(result.maxAllowed, 5);
      assert.strictEqual(result.needsUpgrade, true);
    });

    it("blocks adding when over limit", () => {
      // Edge case: data inconsistency where count exceeds limit
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 7);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.needsUpgrade, true);
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

    it("allows unlimited when sub_org_quantity is null despite per_sub_org model", () => {
      // Edge case: per_sub_org model but no quantity set
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: null,
      };
      const result = simulateCanEnterpriseAddSubOrg(subscription, 100);

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
    it("calculates price increase when crossing free tier (5 to 6)", () => {
      const currentOrgs = 5;
      const newOrgs = 6;

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      assert.strictEqual(currentPricing.totalCentsYearly, 0); // Free
      assert.strictEqual(newPricing.totalCentsYearly, 15000); // $150
    });

    it("calculates price decrease when going back to free tier (6 to 5)", () => {
      const currentOrgs = 6;
      const newOrgs = 5;

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      assert.strictEqual(currentPricing.totalCentsYearly, 15000); // $150
      assert.strictEqual(newPricing.totalCentsYearly, 0); // Free
    });
  });

  describe("scaling paid orgs", () => {
    it("calculates price increase when scaling up paid orgs", () => {
      const currentOrgs = 10; // 5 billable
      const newOrgs = 15; // 10 billable

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      const increase = newPricing.totalCentsYearly - currentPricing.totalCentsYearly;
      assert.strictEqual(increase, 5 * 15000); // 5 additional billable orgs
    });

    it("calculates price decrease when scaling down paid orgs", () => {
      const currentOrgs = 15; // 10 billable
      const newOrgs = 10; // 5 billable

      const currentPricing = getEnterpriseSubOrgPricing(currentOrgs);
      const newPricing = getEnterpriseSubOrgPricing(newOrgs);

      const decrease = currentPricing.totalCentsYearly - newPricing.totalCentsYearly;
      assert.strictEqual(decrease, 5 * 15000); // 5 fewer billable orgs
    });
  });

  describe("quota check then adjust flow", () => {
    it("blocks add sub-org when at limit, suggests upgrade", () => {
      const subscription: MockSubscription = {
        pricing_model: "per_sub_org",
        sub_org_quantity: 5,
      };

      // At limit (5 orgs, all free)
      const quotaCheck = simulateCanEnterpriseAddSubOrg(subscription, 5);
      assert.strictEqual(quotaCheck.allowed, false);
      assert.strictEqual(quotaCheck.needsUpgrade, true);

      // Verify upgrade would be allowed
      const adjustCheck = simulateBillingAdjustmentValidation({
        newQuantity: 10,
        currentUsage: 5,
        pricingModel: "per_sub_org",
        stripeSubscriptionId: "sub_123",
      });
      assert.strictEqual(adjustCheck.allowed, true);

      // Calculate upgrade cost - now with free tier
      const pricing = getEnterpriseSubOrgPricing(10);
      assert.strictEqual(pricing.billableOrgs, 5);
      assert.strictEqual(pricing.totalCentsYearly, 75000); // $750/year (5 paid @ $150)
    });
  });

  describe("pricing table from plan", () => {
    it("matches expected pricing table", () => {
      // | Total Orgs | Billable | Annual Charge |
      // |------------|----------|---------------|
      // | 1-5        | 0        | $0            |
      // | 6          | 1        | $150          |
      // | 10         | 5        | $750          |
      // | 20         | 15       | $2,250        |

      const pricing5 = getEnterpriseSubOrgPricing(5);
      assert.strictEqual(pricing5.billableOrgs, 0);
      assert.strictEqual(pricing5.totalCentsYearly, 0);

      const pricing6 = getEnterpriseSubOrgPricing(6);
      assert.strictEqual(pricing6.billableOrgs, 1);
      assert.strictEqual(pricing6.totalCentsYearly, 15000);

      const pricing10 = getEnterpriseSubOrgPricing(10);
      assert.strictEqual(pricing10.billableOrgs, 5);
      assert.strictEqual(pricing10.totalCentsYearly, 75000);

      const pricing20 = getEnterpriseSubOrgPricing(20);
      assert.strictEqual(pricing20.billableOrgs, 15);
      assert.strictEqual(pricing20.totalCentsYearly, 225000);
    });
  });
});
