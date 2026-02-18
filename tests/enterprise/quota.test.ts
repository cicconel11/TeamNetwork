import { describe, it } from "node:test";
import assert from "node:assert";
import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";
import {
  buildQuotaInfo,
  checkAlumniCapacity,
  evaluateAdoptionQuota,
  evaluateSubOrgCapacity,
} from "@/lib/enterprise/quota-logic";

/**
 * Tests for enterprise quota pure computation functions (hybrid pricing model).
 *
 * These tests directly import and exercise the real functions from quota-logic.ts,
 * following the pattern established by enterprise-quantity-pricing.test.ts.
 * The pure functions are separated from Supabase I/O so they can be tested
 * without database dependencies.
 *
 * Covers:
 * 1. buildQuotaInfo() — constructing quota info from raw data
 * 2. checkAlumniCapacity() — bucket-based alumni limit checks
 * 3. evaluateAdoptionQuota() — org adoption boundary checks
 * 4. evaluateSubOrgCapacity() — always-allowed in hybrid model
 */

const CAPACITY_PER_BUCKET = ALUMNI_BUCKET_PRICING.capacityPerBucket;

// ── Source Constant Integrity ──

describe("source constant integrity", () => {
  it("ALUMNI_BUCKET_PRICING.capacityPerBucket is 2500", () => {
    assert.strictEqual(ALUMNI_BUCKET_PRICING.capacityPerBucket, 2500);
  });

  it("ALUMNI_BUCKET_PRICING.maxSelfServeBuckets is 4", () => {
    assert.strictEqual(ALUMNI_BUCKET_PRICING.maxSelfServeBuckets, 4);
  });
});

// ── buildQuotaInfo ──

describe("buildQuotaInfo", () => {
  it("calculates alumniLimit from bucketQuantity * capacityPerBucket", () => {
    const quota = buildQuotaInfo(3, 5000, 4);
    assert.strictEqual(quota.alumniLimit, 3 * CAPACITY_PER_BUCKET);
    assert.strictEqual(quota.alumniLimit, 7500);
  });

  it("calculates remaining as Math.max(limit - count, 0)", () => {
    const quota = buildQuotaInfo(1, 2000, 2);
    assert.strictEqual(quota.remaining, CAPACITY_PER_BUCKET - 2000);
    assert.strictEqual(quota.remaining, 500);
  });

  it("clamps remaining to zero when over capacity", () => {
    const quota = buildQuotaInfo(1, 2800, 3);
    assert.strictEqual(quota.remaining, 0);
  });

  it("has all required fields", () => {
    const quota = buildQuotaInfo(1, 1000, 2);
    assert.ok("allowed" in quota);
    assert.ok("bucketQuantity" in quota);
    assert.ok("alumniLimit" in quota);
    assert.ok("alumniCount" in quota);
    assert.ok("remaining" in quota);
    assert.ok("subOrgCount" in quota);
  });

  it("remaining cannot be negative", () => {
    const quota = buildQuotaInfo(1, 2800, 3);
    assert.ok(quota.remaining >= 0);
    assert.strictEqual(quota.remaining, 0);
  });

  it("bucketQuantity matches limit calculation", () => {
    const quota = buildQuotaInfo(3, 5000, 4);
    assert.strictEqual(quota.alumniLimit, quota.bucketQuantity * CAPACITY_PER_BUCKET);
  });

  it("calculates correct limit for sentinel 999 buckets (legacy tier_3)", () => {
    const quota = buildQuotaInfo(999, 5000, 3);
    assert.strictEqual(quota.alumniLimit, 999 * CAPACITY_PER_BUCKET);
    assert.strictEqual(quota.alumniLimit, 2497500);
    assert.strictEqual(quota.remaining, 2497500 - 5000);
  });
});

// ── checkAlumniCapacity ──

describe("checkAlumniCapacity", () => {
  it("returns false when quota is null", () => {
    assert.strictEqual(checkAlumniCapacity(null), false);
  });

  it("returns true when adding one alumni stays within bucket limit", () => {
    const quota = buildQuotaInfo(1, CAPACITY_PER_BUCKET - 1, 2);
    assert.strictEqual(checkAlumniCapacity(quota, 1), true);
  });

  it("returns false when adding alumni would exceed bucket capacity", () => {
    const quota = buildQuotaInfo(1, CAPACITY_PER_BUCKET, 2);
    assert.strictEqual(checkAlumniCapacity(quota, 1), false);
  });

  it("returns true when at exact limit and adding zero", () => {
    const quota = buildQuotaInfo(2, 2 * CAPACITY_PER_BUCKET, 2);
    assert.strictEqual(checkAlumniCapacity(quota, 0), true);
  });

  it("returns false when adding multiple alumni would exceed limit", () => {
    const quota = buildQuotaInfo(4, 4 * CAPACITY_PER_BUCKET - 500, 5);
    assert.strictEqual(checkAlumniCapacity(quota, 501), false);
  });

  it("returns true when adding multiple alumni stays within limit", () => {
    const quota = buildQuotaInfo(4, 4 * CAPACITY_PER_BUCKET - 500, 5);
    assert.strictEqual(checkAlumniCapacity(quota, 500), true);
  });

  it("handles edge case of zero alumni count", () => {
    const quota = buildQuotaInfo(1, 0, 0);
    assert.strictEqual(checkAlumniCapacity(quota, CAPACITY_PER_BUCKET), true);
  });

  it("handles multiple buckets (bucket 3 capacity)", () => {
    const quota = buildQuotaInfo(3, 3 * CAPACITY_PER_BUCKET - 500, 3);
    assert.strictEqual(checkAlumniCapacity(quota, 500), true);
  });

  it("allows adding alumni with sentinel 999 bucket quantity", () => {
    const quota = buildQuotaInfo(999, 5000, 3);
    assert.strictEqual(checkAlumniCapacity(quota, 1000), true);
    assert.strictEqual(checkAlumniCapacity(quota, 2497500 - 5000), true);
    assert.strictEqual(checkAlumniCapacity(quota, 2497500 - 5000 + 1), false);
  });
});

// ── evaluateAdoptionQuota ──

describe("evaluateAdoptionQuota", () => {
  it("returns error when quota is null", () => {
    const result = evaluateAdoptionQuota(null, 100);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.error, "Enterprise subscription not found");
  });

  it("allows adoption when within bucket capacity", () => {
    const quota = buildQuotaInfo(2, 2000, 2);
    const result = evaluateAdoptionQuota(quota, 1000);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 3000);
    assert.strictEqual(result.limit, 2 * CAPACITY_PER_BUCKET);
  });

  it("rejects adoption when would exceed bucket capacity", () => {
    const quota = buildQuotaInfo(1, 2000, 3);
    const result = evaluateAdoptionQuota(quota, 600);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.error?.includes("exceed alumni limit"));
    assert.strictEqual(result.wouldBeTotal, 2600);
    assert.strictEqual(result.limit, CAPACITY_PER_BUCKET);
  });

  it("allows adoption at exact limit boundary", () => {
    const quota = buildQuotaInfo(4, 8000, 4);
    const result = evaluateAdoptionQuota(quota, 2000);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 4 * CAPACITY_PER_BUCKET);
  });

  it("rejects adoption when one over limit", () => {
    const quota = buildQuotaInfo(4, 8000, 4);
    const result = evaluateAdoptionQuota(quota, 2001);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.wouldBeTotal, 10001);
  });

  it("handles adoption of org with zero alumni", () => {
    const quota = buildQuotaInfo(1, CAPACITY_PER_BUCKET, 5);
    const result = evaluateAdoptionQuota(quota, 0);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, CAPACITY_PER_BUCKET);
  });

  it("provides upgrade message in error", () => {
    const quota = buildQuotaInfo(1, 2000, 2);
    const result = evaluateAdoptionQuota(quota, 1000);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.error?.includes("Upgrade your alumni bucket"));
  });

  it("includes quota numbers in error message", () => {
    const quota = buildQuotaInfo(2, 3000, 2);
    const result = evaluateAdoptionQuota(quota, 2500);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.error?.includes("5500")); // wouldBeTotal
    assert.ok(result.error?.includes(`${2 * CAPACITY_PER_BUCKET}`)); // limit = 5000
  });
});

// ── evaluateSubOrgCapacity ──

describe("evaluateSubOrgCapacity", () => {
  it("returns current count and null maxAllowed (no hard cap in hybrid model)", () => {
    const result = evaluateSubOrgCapacity(5);
    assert.strictEqual(result.currentCount, 5);
    assert.strictEqual(result.maxAllowed, null);
    assert.strictEqual(result.error, undefined);
  });

  it("returns correct current count", () => {
    const result = evaluateSubOrgCapacity(10);
    assert.strictEqual(result.currentCount, 10);
  });

  it("handles zero current count", () => {
    const result = evaluateSubOrgCapacity(0);
    assert.strictEqual(result.currentCount, 0);
    assert.strictEqual(result.error, undefined);
  });

  it("handles large counts without limit", () => {
    const result = evaluateSubOrgCapacity(100);
    assert.strictEqual(result.currentCount, 100);
    assert.strictEqual(result.maxAllowed, null);
  });
});
