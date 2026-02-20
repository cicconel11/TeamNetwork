import test from "node:test";
import assert from "node:assert";
import { z } from "zod";
import { ALUMNI_BUCKET_PRICING, ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";
import type { BillingInterval } from "@/types/enterprise";
import {
  isSalesLed,
  getAlumniBucketPricing,
  getSubOrgPricing,
} from "@/lib/enterprise/pricing";
import { buildQuotaInfo, resolveCurrentQuantity } from "@/lib/enterprise/quota-logic";

/**
 * Tests for GET/POST /api/enterprise/[enterpriseId]/billing
 *
 * Simulates the billing route logic using real pricing and quota functions
 * to ensure sales-managed detection works correctly.
 */

// Mirrors the route's updateBucketSchema
const updateBucketSchema = z
  .object({
    alumniBucketQuantity: z.number().int().min(1).max(4),
  })
  .strict();

// Simulate billing GET response construction (mirrors route.ts logic)
function simulateBillingGet(params: {
  alumniBucketQuantity: number;
  billingInterval: BillingInterval;
  subOrgQuantity: number;
  alumniCount: number;
  subOrgCount: number;
}) {
  const { alumniBucketQuantity, billingInterval, subOrgQuantity, alumniCount, subOrgCount } = params;

  const salesManaged = isSalesLed(alumniBucketQuantity);
  const subOrgPricing = getSubOrgPricing(subOrgQuantity, billingInterval);
  const quota = buildQuotaInfo(alumniBucketQuantity, alumniCount, subOrgCount);

  const pricing = salesManaged
    ? {
        alumni: { mode: "sales_managed" as const, unitCents: null, totalCents: null, capacity: null },
        subOrgs: subOrgPricing,
        totalCents: null,
      }
    : (() => {
        const alumniPricing = getAlumniBucketPricing(alumniBucketQuantity, billingInterval);
        return {
          alumni: { mode: "self_serve" as const, ...alumniPricing },
          subOrgs: subOrgPricing,
          totalCents: alumniPricing.totalCents + subOrgPricing.totalCents,
        };
      })();

  return {
    salesManaged,
    alumniBucketQuantity,
    alumniCapacity: alumniBucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket,
    pricing,
    usage: {
      alumniCount: quota.alumniCount,
      alumniLimit: quota.alumniLimit,
      remaining: quota.remaining,
      subOrgCount: quota.subOrgCount,
    },
  };
}

// ── Sales-Managed Detection Tests ──

test("billing GET with bucket 999 returns salesManaged: true", () => {
  const result = simulateBillingGet({
    alumniBucketQuantity: 999,
    billingInterval: "year",
    subOrgQuantity: 5,
    alumniCount: 5000,
    subOrgCount: 3,
  });

  assert.strictEqual(result.salesManaged, true);
  assert.strictEqual(result.pricing.alumni.mode, "sales_managed");
  assert.strictEqual(result.pricing.alumni.unitCents, null);
  assert.strictEqual(result.pricing.alumni.totalCents, null);
  assert.strictEqual(result.pricing.alumni.capacity, null);
  assert.strictEqual(result.pricing.totalCents, null);
});

test("billing GET with bucket 999 still returns numeric sub-org pricing", () => {
  const result = simulateBillingGet({
    alumniBucketQuantity: 999,
    billingInterval: "year",
    subOrgQuantity: 5,
    alumniCount: 5000,
    subOrgCount: 3,
  });

  assert.strictEqual(result.pricing.subOrgs.billableOrgs, 2);
  assert.strictEqual(result.pricing.subOrgs.totalCents, 30000); // 2 x $150/yr
});

test("billing GET with bucket 999 still returns numeric usage", () => {
  const result = simulateBillingGet({
    alumniBucketQuantity: 999,
    billingInterval: "year",
    subOrgQuantity: 5,
    alumniCount: 5000,
    subOrgCount: 3,
  });

  assert.strictEqual(result.usage.alumniCount, 5000);
  assert.strictEqual(result.usage.alumniLimit, 999 * 2500);
  assert.strictEqual(result.usage.remaining, 999 * 2500 - 5000);
  assert.strictEqual(result.usage.subOrgCount, 3);
});

test("billing GET with bucket 2 returns salesManaged: false with numeric pricing", () => {
  const result = simulateBillingGet({
    alumniBucketQuantity: 2,
    billingInterval: "month",
    subOrgQuantity: 4,
    alumniCount: 3000,
    subOrgCount: 4,
  });

  assert.strictEqual(result.salesManaged, false);
  assert.strictEqual(result.pricing.alumni.mode, "self_serve");
  assert.strictEqual((result.pricing.alumni as any).unitCents, 5000);
  assert.strictEqual((result.pricing.alumni as any).totalCents, 10000);
  assert.strictEqual((result.pricing.alumni as any).capacity, 5000);
  assert.strictEqual(result.pricing.totalCents, 10000 + 1500); // alumni + 1 billable org
});

test("billing GET with bucket 5 returns salesManaged: true", () => {
  const result = simulateBillingGet({
    alumniBucketQuantity: 5,
    billingInterval: "month",
    subOrgQuantity: 3,
    alumniCount: 10000,
    subOrgCount: 3,
  });

  assert.strictEqual(result.salesManaged, true);
  assert.strictEqual(result.pricing.alumni.mode, "sales_managed");
  assert.strictEqual(result.pricing.totalCents, null);
});

test("billing GET with bucket 4 returns salesManaged: false (max self-serve)", () => {
  const result = simulateBillingGet({
    alumniBucketQuantity: 4,
    billingInterval: "year",
    subOrgQuantity: 3,
    alumniCount: 8000,
    subOrgCount: 3,
  });

  assert.strictEqual(result.salesManaged, false);
  assert.strictEqual(result.pricing.alumni.mode, "self_serve");
  assert.ok(typeof result.pricing.totalCents === "number");
});

// ── POST Schema Validation Tests ──

test("billing POST schema rejects bucket 999 (max is 4)", () => {
  const result = updateBucketSchema.safeParse({ alumniBucketQuantity: 999 });
  assert.strictEqual(result.success, false);
});

test("billing POST schema rejects bucket 5", () => {
  const result = updateBucketSchema.safeParse({ alumniBucketQuantity: 5 });
  assert.strictEqual(result.success, false);
});

test("billing POST schema accepts buckets 1-4", () => {
  for (let i = 1; i <= 4; i++) {
    const result = updateBucketSchema.safeParse({ alumniBucketQuantity: i });
    assert.strictEqual(result.success, true, `Bucket ${i} should be accepted`);
  }
});

test("billing POST schema rejects non-integer", () => {
  const result = updateBucketSchema.safeParse({ alumniBucketQuantity: 2.5 });
  assert.strictEqual(result.success, false);
});

test("billing POST schema rejects 0", () => {
  const result = updateBucketSchema.safeParse({ alumniBucketQuantity: 0 });
  assert.strictEqual(result.success, false);
});

// ── resolveCurrentQuantity Tests ──
// Tests for the null-safe fallback used in handleAddSeats (BillingClient.tsx)
// and extracted as a pure function in quota-logic.ts.

test("resolveCurrentQuantity returns rawQuantity when it is a positive number", () => {
  assert.strictEqual(resolveCurrentQuantity(5, 3), 5);
});

test("resolveCurrentQuantity returns rawQuantity when it is the number 0 (falsy but not null)", () => {
  // 0 is a valid explicit quantity; the null check (rawQuantity != null) preserves it
  assert.strictEqual(resolveCurrentQuantity(0, 7), 0);
});

test("resolveCurrentQuantity returns rawQuantity of 1 even though it is below the free baseline", () => {
  // An explicit 1 should be returned as-is — the fallback only activates when null/undefined
  assert.strictEqual(resolveCurrentQuantity(1, 0), 1);
});

test("resolveCurrentQuantity falls back to freeBaseline when rawQuantity is null and subOrgCount is 0", () => {
  // The free-tier baseline is ENTERPRISE_SEAT_PRICING.freeSubOrgs = 3
  assert.strictEqual(
    resolveCurrentQuantity(null, 0, ENTERPRISE_SEAT_PRICING.freeSubOrgs),
    3
  );
});

test("resolveCurrentQuantity falls back to freeBaseline (3) when rawQuantity is undefined and subOrgCount is 0", () => {
  assert.strictEqual(resolveCurrentQuantity(undefined, 0), 3);
});

test("resolveCurrentQuantity falls back to subOrgCount when it exceeds the freeBaseline", () => {
  // subOrgCount=10 > freeBaseline=3, so result is 10
  assert.strictEqual(resolveCurrentQuantity(null, 10), 10);
});

test("resolveCurrentQuantity uses freeBaseline when subOrgCount equals freeBaseline", () => {
  assert.strictEqual(resolveCurrentQuantity(null, 3), 3);
});

test("resolveCurrentQuantity uses freeBaseline when subOrgCount is less than freeBaseline", () => {
  assert.strictEqual(resolveCurrentQuantity(null, 1), 3);
  assert.strictEqual(resolveCurrentQuantity(null, 2), 3);
});

test("resolveCurrentQuantity respects a custom freeBaseline parameter", () => {
  assert.strictEqual(resolveCurrentQuantity(null, 0, 5), 5);
  assert.strictEqual(resolveCurrentQuantity(null, 7, 5), 7);
  assert.strictEqual(resolveCurrentQuantity(null, 4, 5), 5);
});
