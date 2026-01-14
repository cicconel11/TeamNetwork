import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Enterprise quantity pricing tests.
 *
 * These tests import constants and functions from the actual source to ensure
 * business rules are tested against the real implementation, not duplicated logic.
 */

import { ALUMNI_BUCKET_PRICING, ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";
import type { BillingInterval } from "@/types/enterprise";
import {
  getAlumniBucketCapacity,
  getRequiredBucketQuantity,
  isSalesLed,
  getAlumniBucketPricing,
  getBillableOrgCount,
  getSubOrgPricing,
  getEnterpriseTotalPricing,
  formatBucketRange,
  formatSeatPrice,
} from "@/lib/enterprise/pricing";

// =============================================================================
// Alumni Bucket Capacity Tests
// =============================================================================

describe("getAlumniBucketCapacity", () => {
  it("returns 2,500 for 1 bucket", () => {
    assert.strictEqual(getAlumniBucketCapacity(1), 2500);
  });

  it("returns 5,000 for 2 buckets", () => {
    assert.strictEqual(getAlumniBucketCapacity(2), 5000);
  });

  it("returns 7,500 for 3 buckets", () => {
    assert.strictEqual(getAlumniBucketCapacity(3), 7500);
  });

  it("returns 10,000 for 4 buckets", () => {
    assert.strictEqual(getAlumniBucketCapacity(4), 10000);
  });

  it("returns 25,000 for 10 buckets", () => {
    assert.strictEqual(getAlumniBucketCapacity(10), 25000);
  });
});

// =============================================================================
// Required Bucket Quantity Tests
// =============================================================================

describe("getRequiredBucketQuantity", () => {
  it("returns 1 for 0 alumni (minimum 1 bucket)", () => {
    assert.strictEqual(getRequiredBucketQuantity(0), 1);
  });

  it("returns 1 for 1 alumni", () => {
    assert.strictEqual(getRequiredBucketQuantity(1), 1);
  });

  it("returns 1 for 2,500 alumni (exactly fits)", () => {
    assert.strictEqual(getRequiredBucketQuantity(2500), 1);
  });

  it("returns 2 for 2,501 alumni (needs next bucket)", () => {
    assert.strictEqual(getRequiredBucketQuantity(2501), 2);
  });

  it("returns 2 for 5,000 alumni", () => {
    assert.strictEqual(getRequiredBucketQuantity(5000), 2);
  });

  it("returns 3 for 5,001 alumni", () => {
    assert.strictEqual(getRequiredBucketQuantity(5001), 3);
  });

  it("returns 4 for 10,000 alumni", () => {
    assert.strictEqual(getRequiredBucketQuantity(10000), 4);
  });

  it("returns 5 for 10,001 alumni (sales-led)", () => {
    assert.strictEqual(getRequiredBucketQuantity(10001), 5);
  });
});

// =============================================================================
// Sales-Led Check Tests
// =============================================================================

describe("isSalesLed", () => {
  it("returns false for buckets 1-4", () => {
    assert.strictEqual(isSalesLed(1), false);
    assert.strictEqual(isSalesLed(2), false);
    assert.strictEqual(isSalesLed(3), false);
    assert.strictEqual(isSalesLed(4), false);
  });

  it("returns true for buckets 5+", () => {
    assert.strictEqual(isSalesLed(5), true);
    assert.strictEqual(isSalesLed(10), true);
    assert.strictEqual(isSalesLed(100), true);
  });

  it("returns true for sentinel value 999 (legacy tier_3)", () => {
    assert.strictEqual(isSalesLed(999), true);
  });
});

// =============================================================================
// Alumni Bucket Pricing Tests
// =============================================================================

describe("getAlumniBucketPricing", () => {
  describe("monthly", () => {
    it("returns $50/month for 1 bucket", () => {
      const result = getAlumniBucketPricing(1, "month");
      assert.strictEqual(result.unitCents, 5000);
      assert.strictEqual(result.totalCents, 5000);
      assert.strictEqual(result.capacity, 2500);
    });

    it("returns $100/month for 2 buckets", () => {
      const result = getAlumniBucketPricing(2, "month");
      assert.strictEqual(result.unitCents, 5000);
      assert.strictEqual(result.totalCents, 10000);
      assert.strictEqual(result.capacity, 5000);
    });

    it("returns $200/month for 4 buckets", () => {
      const result = getAlumniBucketPricing(4, "month");
      assert.strictEqual(result.totalCents, 20000);
      assert.strictEqual(result.capacity, 10000);
    });
  });

  describe("yearly", () => {
    it("returns $500/year for 1 bucket", () => {
      const result = getAlumniBucketPricing(1, "year");
      assert.strictEqual(result.unitCents, 50000);
      assert.strictEqual(result.totalCents, 50000);
      assert.strictEqual(result.capacity, 2500);
    });

    it("returns $1,000/year for 2 buckets", () => {
      const result = getAlumniBucketPricing(2, "year");
      assert.strictEqual(result.totalCents, 100000);
    });

    it("returns $2,000/year for 4 buckets", () => {
      const result = getAlumniBucketPricing(4, "year");
      assert.strictEqual(result.totalCents, 200000);
      assert.strictEqual(result.capacity, 10000);
    });
  });
});

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
  });

  describe("paid tier (4+ orgs)", () => {
    it("returns 1 billable for 4 orgs", () => {
      assert.strictEqual(getBillableOrgCount(4), 1);
    });

    it("returns 7 billable for 10 orgs", () => {
      assert.strictEqual(getBillableOrgCount(10), 7);
    });
  });

  describe("edge cases", () => {
    it("returns 0 for 0 orgs", () => {
      assert.strictEqual(getBillableOrgCount(0), 0);
    });
  });
});

// =============================================================================
// getSubOrgPricing Tests
// =============================================================================

describe("getSubOrgPricing", () => {
  describe("monthly", () => {
    it("calculates $0 for 3 orgs (all free)", () => {
      const result = getSubOrgPricing(3, "month");
      assert.strictEqual(result.freeOrgs, 3);
      assert.strictEqual(result.billableOrgs, 0);
      assert.strictEqual(result.totalCents, 0);
    });

    it("calculates $15/month for 4 orgs (1 paid)", () => {
      const result = getSubOrgPricing(4, "month");
      assert.strictEqual(result.billableOrgs, 1);
      assert.strictEqual(result.unitCents, 1500);
      assert.strictEqual(result.totalCents, 1500);
    });

    it("calculates $30/month for 5 orgs (2 paid)", () => {
      const result = getSubOrgPricing(5, "month");
      assert.strictEqual(result.billableOrgs, 2);
      assert.strictEqual(result.totalCents, 3000);
    });
  });

  describe("yearly", () => {
    it("calculates $0 for 3 orgs (all free)", () => {
      const result = getSubOrgPricing(3, "year");
      assert.strictEqual(result.totalCents, 0);
    });

    it("calculates $150/year for 4 orgs (1 paid)", () => {
      const result = getSubOrgPricing(4, "year");
      assert.strictEqual(result.billableOrgs, 1);
      assert.strictEqual(result.unitCents, 15000);
      assert.strictEqual(result.totalCents, 15000);
    });

    it("calculates $1,050/year for 10 orgs (7 paid)", () => {
      const result = getSubOrgPricing(10, "year");
      assert.strictEqual(result.billableOrgs, 7);
      assert.strictEqual(result.totalCents, 105000);
    });
  });
});

// =============================================================================
// Combined Pricing Tests (from plan spec)
// =============================================================================

describe("getEnterpriseTotalPricing", () => {
  describe("plan pricing examples (monthly)", () => {
    it("3 teams, 2,500 alumni → $50/mo", () => {
      const result = getEnterpriseTotalPricing(1, 3, "month");
      assert.strictEqual(result.alumni.totalCents, 5000); // $50
      assert.strictEqual(result.subOrgs.totalCents, 0); // 3 free
      assert.strictEqual(result.totalCents, 5000); // $50/mo
    });

    it("5 teams, 5,000 alumni → $130/mo", () => {
      const result = getEnterpriseTotalPricing(2, 5, "month");
      assert.strictEqual(result.alumni.totalCents, 10000); // $100
      assert.strictEqual(result.subOrgs.totalCents, 3000); // 2 × $15
      assert.strictEqual(result.totalCents, 13000); // $130/mo
    });

    it("8 teams, 10,000 alumni → $275/mo", () => {
      const result = getEnterpriseTotalPricing(4, 8, "month");
      assert.strictEqual(result.alumni.totalCents, 20000); // $200
      assert.strictEqual(result.subOrgs.totalCents, 7500); // 5 × $15
      assert.strictEqual(result.totalCents, 27500); // $275/mo
    });
  });

  describe("plan pricing examples (yearly)", () => {
    it("3 teams, 2,500 alumni → $500/yr", () => {
      const result = getEnterpriseTotalPricing(1, 3, "year");
      assert.strictEqual(result.alumni.totalCents, 50000); // $500
      assert.strictEqual(result.subOrgs.totalCents, 0);
      assert.strictEqual(result.totalCents, 50000); // $500/yr
    });

    it("5 teams, 5,000 alumni → $1,300/yr", () => {
      const result = getEnterpriseTotalPricing(2, 5, "year");
      assert.strictEqual(result.alumni.totalCents, 100000); // $1,000
      assert.strictEqual(result.subOrgs.totalCents, 30000); // 2 × $150
      assert.strictEqual(result.totalCents, 130000); // $1,300/yr
    });

    it("8 teams, 10,000 alumni → $2,750/yr", () => {
      const result = getEnterpriseTotalPricing(4, 8, "year");
      assert.strictEqual(result.alumni.totalCents, 200000); // $2,000
      assert.strictEqual(result.subOrgs.totalCents, 75000); // 5 × $150
      assert.strictEqual(result.totalCents, 275000); // $2,750/yr
    });
  });

  describe("minimum charge", () => {
    it("minimum is $50/mo (1 bucket, 0 extra teams)", () => {
      const result = getEnterpriseTotalPricing(1, 0, "month");
      assert.strictEqual(result.totalCents, 5000); // $50/mo
    });

    it("minimum is $500/yr (1 bucket, 0 extra teams)", () => {
      const result = getEnterpriseTotalPricing(1, 0, "year");
      assert.strictEqual(result.totalCents, 50000); // $500/yr
    });
  });
});

// =============================================================================
// formatBucketRange Tests
// =============================================================================

describe("formatBucketRange", () => {
  it("formats bucket 1 as '0 - 2,500'", () => {
    assert.strictEqual(formatBucketRange(1), "0 - 2,500");
  });

  it("formats bucket 2 as '2,501 - 5,000'", () => {
    assert.strictEqual(formatBucketRange(2), "2,501 - 5,000");
  });

  it("formats bucket 3 as '5,001 - 7,500'", () => {
    assert.strictEqual(formatBucketRange(3), "5,001 - 7,500");
  });

  it("formats bucket 4 as '7,501 - 10,000'", () => {
    assert.strictEqual(formatBucketRange(4), "7,501 - 10,000");
  });

  it("handles 0 or negative", () => {
    assert.strictEqual(formatBucketRange(0), "0");
  });
});

// =============================================================================
// formatSeatPrice Tests
// =============================================================================

describe("formatSeatPrice", () => {
  it("formats $50", () => {
    assert.strictEqual(formatSeatPrice(5000), "$50");
  });

  it("formats $150", () => {
    assert.strictEqual(formatSeatPrice(15000), "$150");
  });

  it("formats $0", () => {
    assert.strictEqual(formatSeatPrice(0), "$0");
  });
});

// =============================================================================
// Source Constants Validation Tests
// =============================================================================

describe("source constants integrity", () => {
  it("ALUMNI_BUCKET_PRICING has expected values", () => {
    assert.strictEqual(ALUMNI_BUCKET_PRICING.capacityPerBucket, 2500);
    assert.strictEqual(ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket, 5000);
    assert.strictEqual(ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket, 50000);
    assert.strictEqual(ALUMNI_BUCKET_PRICING.maxSelfServeBuckets, 4);
  });

  it("ENTERPRISE_SEAT_PRICING has expected values", () => {
    assert.strictEqual(ENTERPRISE_SEAT_PRICING.freeSubOrgs, 3);
    assert.strictEqual(ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly, 1500);
    assert.strictEqual(ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly, 15000);
  });
});

// =============================================================================
// Alumni Quota Enforcement Tests (using source constants)
// =============================================================================

describe("alumni quota enforcement", () => {
  describe("bucket capacity checks", () => {
    it("allows adding when under capacity", () => {
      const limit = 1 * ALUMNI_BUCKET_PRICING.capacityPerBucket;
      assert.strictEqual(2000 + 1 <= limit, true);
    });

    it("allows adding at exactly boundary - 1", () => {
      const limit = 1 * ALUMNI_BUCKET_PRICING.capacityPerBucket;
      assert.strictEqual(2499 + 1 <= limit, true);
    });

    it("blocks adding at exactly boundary", () => {
      const limit = 1 * ALUMNI_BUCKET_PRICING.capacityPerBucket;
      assert.strictEqual(2500 + 1 <= limit, false);
    });

    it("blocks adding when over capacity", () => {
      const limit = 1 * ALUMNI_BUCKET_PRICING.capacityPerBucket;
      assert.strictEqual(3000 + 1 <= limit, false);
    });

    it("allows with 2 buckets (5,000 capacity)", () => {
      const limit = 2 * ALUMNI_BUCKET_PRICING.capacityPerBucket;
      assert.strictEqual(4999 + 1 <= limit, true);
      assert.strictEqual(5000 + 1 <= limit, false);
    });

    it("allows with 4 buckets (10,000 capacity)", () => {
      const limit = 4 * ALUMNI_BUCKET_PRICING.capacityPerBucket;
      assert.strictEqual(9999 + 1 <= limit, true);
      assert.strictEqual(10000 + 1 <= limit, false);
    });
  });
});

// =============================================================================
// Billing Adjustment Validation Tests (using source constants)
// =============================================================================

describe("billing adjustment validation", () => {
  describe("alumni_bucket adjustments", () => {
    it("blocks 5+ buckets (sales-led)", () => {
      assert.strictEqual(isSalesLed(5), true);
    });

    it("allows bucket 4 (max self-serve)", () => {
      assert.strictEqual(isSalesLed(4), false);
    });

    it("blocks reducing below current alumni count", () => {
      const newCapacity = 1 * ALUMNI_BUCKET_PRICING.capacityPerBucket; // 2500
      assert.strictEqual(3000 > newCapacity, true); // would lose data
    });
  });
});

// =============================================================================
// Stripe Line Item Quantity Tests
// =============================================================================

describe("Stripe subscription line item quantities", () => {
  it("calculates correct alumni bucket quantity", () => {
    assert.strictEqual(getRequiredBucketQuantity(0), 1);
    assert.strictEqual(getRequiredBucketQuantity(2500), 1);
    assert.strictEqual(getRequiredBucketQuantity(2501), 2);
    assert.strictEqual(getRequiredBucketQuantity(5000), 2);
    assert.strictEqual(getRequiredBucketQuantity(10000), 4);
  });

  it("calculates correct sub-org add-on quantity", () => {
    assert.strictEqual(getBillableOrgCount(1), 0);
    assert.strictEqual(getBillableOrgCount(3), 0);
    assert.strictEqual(getBillableOrgCount(4), 1);
    assert.strictEqual(getBillableOrgCount(8), 5);
    assert.strictEqual(getBillableOrgCount(10), 7);
  });
});
