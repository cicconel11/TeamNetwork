import test from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";
import { getBillableOrgCount, getSubOrgPricing } from "@/lib/enterprise/pricing";

/**
 * Tests for POST /api/enterprise/[enterpriseId]/billing/adjust
 *
 * Since this route calls Stripe and the service client, we simulate
 * the route logic using the real helper functions it relies on (getBillableOrgCount,
 * getSubOrgPricing, ALUMNI_BUCKET_PRICING constants) and verify the key
 * branching behavior documented in the route:
 *
 * 1. Zod schema validation (adjustType, newQuantity, expectedCurrentQuantity)
 * 2. DB write failure after Stripe success → 500, no schema detail leakage
 * 3. Usage guard: cannot reduce below current usage
 * 4. Stale-state conflict detection (409 on quantity mismatch)
 * 5. Sales-led guard for alumni_bucket > maxSelfServeBuckets
 */

// ── Mirrors adjustQuantitySchema from billing/adjust/route.ts ─────────────────

const adjustQuantitySchema = z
  .object({
    adjustType: z.enum(["sub_org", "alumni_bucket"]),
    newQuantity: z.number().int().min(1).max(1000),
    expectedCurrentQuantity: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

// ── Simulation helpers ────────────────────────────────────────────────────────

interface SubOrgAdjustParams {
  newQuantity: number;
  currentManagedOrgCount: number;
  currentSubOrgQuantity: number;
  expectedCurrentQuantity?: number;
  stripeError: boolean;
  dbWriteError: boolean;
  hasBillingInterval: "month" | "year";
}

interface SubOrgAdjustResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates the sub_org adjustment path in billing/adjust/route.ts.
 *
 * Key logic being tested:
 * - Quantity conflict → 409
 * - Usage guard → 400 with currentUsage
 * - Stripe success + DB failure → 500 with non-schema-leaking message
 * - Success → 200 with subscription details
 */
function simulateSubOrgAdjust(params: SubOrgAdjustParams): SubOrgAdjustResult {
  const {
    newQuantity,
    currentManagedOrgCount,
    currentSubOrgQuantity,
    expectedCurrentQuantity,
    stripeError,
    dbWriteError,
    hasBillingInterval,
  } = params;

  // Stale UI state guard
  if (expectedCurrentQuantity !== undefined && currentSubOrgQuantity !== expectedCurrentQuantity) {
    return {
      status: 409,
      body: {
        error: "Seat quantity changed. Please refresh and try again.",
        currentQuantity: currentSubOrgQuantity,
      },
    };
  }

  // Usage guard
  if (newQuantity < currentManagedOrgCount) {
    return {
      status: 400,
      body: {
        error: `Cannot reduce seat quantity below current usage. You currently have ${currentManagedOrgCount} enterprise-managed organization(s). Remove some organizations first or choose a quantity of at least ${currentManagedOrgCount}.`,
        currentUsage: currentManagedOrgCount,
        requestedQuantity: newQuantity,
      },
    };
  }

  const oldBillable = getBillableOrgCount(currentSubOrgQuantity);
  const newBillable = getBillableOrgCount(newQuantity);

  // Stripe error
  if (stripeError && (oldBillable !== 0 || newBillable !== 0)) {
    return { status: 500, body: { error: "Failed to update subscription" } };
  }

  // DB write failure after Stripe success (highest financial risk scenario)
  if (dbWriteError) {
    return {
      status: 500,
      body: { error: "Billing updated but failed to save. Please contact support." },
    };
  }

  const pricing = getSubOrgPricing(newQuantity, hasBillingInterval);

  return {
    status: 200,
    body: {
      success: true,
      subscription: {
        quantity: newQuantity,
        currentUsage: currentManagedOrgCount,
        availableSeats: newQuantity - currentManagedOrgCount,
        freeOrgs: pricing.freeOrgs,
        billableOrgs: pricing.billableOrgs,
        totalCents: pricing.totalCents,
      },
    },
  };
}

interface AlumniBucketAdjustParams {
  newQuantity: number;
  currentAlumniCount: number;
  currentBucketQuantity: number;
  expectedCurrentQuantity?: number;
  stripeError: boolean;
  dbWriteError: boolean;
  hasBillingInterval: "month" | "year";
}

/**
 * Simulates the alumni_bucket adjustment path in billing/adjust/route.ts.
 *
 * Key logic being tested:
 * - Sales-led guard > maxSelfServeBuckets → 400
 * - Quantity conflict → 409
 * - Capacity guard → 400
 * - DB write failure after Stripe success → 500 with non-schema-leaking message
 */
function simulateAlumniBucketAdjust(params: AlumniBucketAdjustParams): SubOrgAdjustResult {
  const {
    newQuantity,
    currentAlumniCount,
    currentBucketQuantity,
    expectedCurrentQuantity,
    stripeError,
    dbWriteError,
    hasBillingInterval,
  } = params;

  // Sales-led guard
  if (newQuantity > ALUMNI_BUCKET_PRICING.maxSelfServeBuckets) {
    return {
      status: 400,
      body: {
        error: "For more than 4 alumni buckets (10,000+ alumni capacity), please contact sales.",
        salesLed: true,
      },
    };
  }

  // Stale UI state guard
  if (expectedCurrentQuantity !== undefined && currentBucketQuantity !== expectedCurrentQuantity) {
    return {
      status: 409,
      body: {
        error: "Alumni bucket quantity changed. Please refresh and try again.",
        currentQuantity: currentBucketQuantity,
      },
    };
  }

  const newCapacity = newQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;

  // Capacity guard
  if (newCapacity < currentAlumniCount) {
    return {
      status: 400,
      body: {
        error: `Cannot reduce alumni bucket capacity below current usage. You currently have ${currentAlumniCount} alumni. New capacity would be ${newCapacity}. Choose a quantity of at least ${Math.ceil(currentAlumniCount / ALUMNI_BUCKET_PRICING.capacityPerBucket)} bucket(s).`,
        currentUsage: currentAlumniCount,
        newCapacity,
        requestedQuantity: newQuantity,
      },
    };
  }

  // Stripe error
  if (stripeError) {
    return { status: 500, body: { error: "Failed to update alumni bucket subscription" } };
  }

  // DB write failure after Stripe success (highest financial risk scenario)
  if (dbWriteError) {
    return {
      status: 500,
      body: { error: "Billing updated but failed to save. Please contact support." },
    };
  }

  const unitCents = hasBillingInterval === "month"
    ? ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket
    : ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket;

  return {
    status: 200,
    body: {
      success: true,
      alumniBuckets: {
        quantity: newQuantity,
        capacity: newCapacity,
        currentUsage: currentAlumniCount,
        available: newCapacity - currentAlumniCount,
        unitCents,
        totalCents: newQuantity * unitCents,
      },
    },
  };
}

// ── Schema validation tests ────────────────────────────────────────────────────

test("adjustQuantitySchema accepts valid sub_org input", () => {
  const result = adjustQuantitySchema.safeParse({ adjustType: "sub_org", newQuantity: 5 });
  assert.strictEqual(result.success, true);
});

test("adjustQuantitySchema accepts valid alumni_bucket input", () => {
  const result = adjustQuantitySchema.safeParse({ adjustType: "alumni_bucket", newQuantity: 3 });
  assert.strictEqual(result.success, true);
});

test("adjustQuantitySchema accepts optional expectedCurrentQuantity", () => {
  const result = adjustQuantitySchema.safeParse({
    adjustType: "sub_org",
    newQuantity: 5,
    expectedCurrentQuantity: 4,
  });
  assert.strictEqual(result.success, true);
});

test("adjustQuantitySchema rejects invalid adjustType", () => {
  const result = adjustQuantitySchema.safeParse({ adjustType: "unknown", newQuantity: 5 });
  assert.strictEqual(result.success, false);
});

test("adjustQuantitySchema rejects non-integer newQuantity", () => {
  const result = adjustQuantitySchema.safeParse({ adjustType: "sub_org", newQuantity: 2.5 });
  assert.strictEqual(result.success, false);
});

test("adjustQuantitySchema rejects newQuantity of 0", () => {
  const result = adjustQuantitySchema.safeParse({ adjustType: "sub_org", newQuantity: 0 });
  assert.strictEqual(result.success, false);
});

test("adjustQuantitySchema rejects newQuantity above 1000", () => {
  const result = adjustQuantitySchema.safeParse({ adjustType: "sub_org", newQuantity: 1001 });
  assert.strictEqual(result.success, false);
});

test("adjustQuantitySchema rejects extra unknown fields (strict)", () => {
  const result = adjustQuantitySchema.safeParse({
    adjustType: "sub_org",
    newQuantity: 5,
    extraField: "unexpected",
  });
  assert.strictEqual(result.success, false);
});

// ── Sub-org adjust: DB write failure after Stripe (critical financial risk) ────

test("sub_org: returns 500 when DB write fails after Stripe success (data loss prevention)", () => {
  const result = simulateSubOrgAdjust({
    newQuantity: 5,
    currentManagedOrgCount: 3,
    currentSubOrgQuantity: 4,
    stripeError: false,
    dbWriteError: true,
    hasBillingInterval: "month",
  });

  assert.strictEqual(result.status, 500);
  assert.ok(result.body.error);
});

test("sub_org: DB write failure error message does not leak schema details", () => {
  const result = simulateSubOrgAdjust({
    newQuantity: 5,
    currentManagedOrgCount: 3,
    currentSubOrgQuantity: 4,
    stripeError: false,
    dbWriteError: true,
    hasBillingInterval: "month",
  });

  const errorMsg = result.body.error as string;
  // Must NOT contain SQL error details, table names, column names
  assert.ok(!errorMsg.includes("enterprise_subscriptions"), "Error leaks table name");
  assert.ok(!errorMsg.includes("column"), "Error leaks column reference");
  assert.ok(!errorMsg.includes("constraint"), "Error leaks constraint name");
  // Must contain user-friendly guidance
  assert.ok(errorMsg.includes("contact support") || errorMsg.includes("failed to save"));
});

test("sub_org: returns 409 when expectedCurrentQuantity doesn't match DB value", () => {
  const result = simulateSubOrgAdjust({
    newQuantity: 5,
    currentManagedOrgCount: 2,
    currentSubOrgQuantity: 4,
    expectedCurrentQuantity: 3, // mismatch: DB has 4, client sent 3
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "month",
  });

  assert.strictEqual(result.status, 409);
  assert.ok(result.body.error);
  assert.ok((result.body.error as string).includes("refresh"));
  assert.strictEqual(result.body.currentQuantity, 4);
});

test("sub_org: no conflict when expectedCurrentQuantity matches", () => {
  const result = simulateSubOrgAdjust({
    newQuantity: 5,
    currentManagedOrgCount: 2,
    currentSubOrgQuantity: 4,
    expectedCurrentQuantity: 4, // matches DB
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "month",
  });

  assert.strictEqual(result.status, 200);
});

test("sub_org: returns 400 when new quantity is below current managed org count", () => {
  const result = simulateSubOrgAdjust({
    newQuantity: 2,
    currentManagedOrgCount: 5, // have 5 orgs, trying to reduce to 2
    currentSubOrgQuantity: 5,
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "month",
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.currentUsage, 5);
  assert.strictEqual(result.body.requestedQuantity, 2);
  assert.ok((result.body.error as string).includes("current usage"));
});

test("sub_org: succeeds with valid increase (free tier, no Stripe needed)", () => {
  // 3 → 3 orgs: both are free tier (billableOrgs = 0), no Stripe call needed
  const result = simulateSubOrgAdjust({
    newQuantity: 3,
    currentManagedOrgCount: 1,
    currentSubOrgQuantity: 2,
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "year",
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.success, true);
});

// ── Alumni bucket adjust: DB write failure after Stripe ────────────────────────

test("alumni_bucket: returns 500 when DB write fails after Stripe success", () => {
  const result = simulateAlumniBucketAdjust({
    newQuantity: 2,
    currentAlumniCount: 1000,
    currentBucketQuantity: 1,
    stripeError: false,
    dbWriteError: true,
    hasBillingInterval: "month",
  });

  assert.strictEqual(result.status, 500);
  assert.ok(result.body.error);
});

test("alumni_bucket: DB write failure error message does not leak schema details", () => {
  const result = simulateAlumniBucketAdjust({
    newQuantity: 2,
    currentAlumniCount: 1000,
    currentBucketQuantity: 1,
    stripeError: false,
    dbWriteError: true,
    hasBillingInterval: "month",
  });

  const errorMsg = result.body.error as string;
  assert.ok(!errorMsg.includes("enterprise_subscriptions"), "Error leaks table name");
  assert.ok(!errorMsg.includes("column"), "Error leaks column reference");
  assert.ok(errorMsg.includes("contact support") || errorMsg.includes("failed to save"));
});

test("alumni_bucket: returns 400 with salesLed flag when newQuantity exceeds 4", () => {
  const result = simulateAlumniBucketAdjust({
    newQuantity: 5,
    currentAlumniCount: 0,
    currentBucketQuantity: 4,
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "year",
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.salesLed, true);
  assert.ok((result.body.error as string).includes("contact sales"));
});

test("alumni_bucket: returns 400 when reducing capacity below current alumni count", () => {
  const currentAlumniCount = 3000; // 3000 alumni, trying to reduce to 1 bucket (2500 cap)
  const result = simulateAlumniBucketAdjust({
    newQuantity: 1,
    currentAlumniCount,
    currentBucketQuantity: 2,
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "month",
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.currentUsage, currentAlumniCount);
  assert.strictEqual(result.body.newCapacity, ALUMNI_BUCKET_PRICING.capacityPerBucket);
  assert.ok((result.body.error as string).includes("below current usage"));
});

test("alumni_bucket: returns 409 on quantity mismatch", () => {
  const result = simulateAlumniBucketAdjust({
    newQuantity: 3,
    currentAlumniCount: 500,
    currentBucketQuantity: 2,
    expectedCurrentQuantity: 1, // mismatch
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "year",
  });

  assert.strictEqual(result.status, 409);
  assert.ok((result.body.error as string).includes("refresh"));
});

test("alumni_bucket: succeeds with valid bucket increase (monthly pricing)", () => {
  const result = simulateAlumniBucketAdjust({
    newQuantity: 2,
    currentAlumniCount: 1000,
    currentBucketQuantity: 1,
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "month",
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.success, true);
  const buckets = result.body.alumniBuckets as Record<string, unknown>;
  assert.strictEqual(buckets.quantity, 2);
  assert.strictEqual(buckets.capacity, 2 * ALUMNI_BUCKET_PRICING.capacityPerBucket);
  assert.strictEqual(buckets.unitCents, ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket);
});

test("alumni_bucket: succeeds with valid bucket increase (yearly pricing)", () => {
  const result = simulateAlumniBucketAdjust({
    newQuantity: 3,
    currentAlumniCount: 2000,
    currentBucketQuantity: 2,
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "year",
  });

  assert.strictEqual(result.status, 200);
  const buckets = result.body.alumniBuckets as Record<string, unknown>;
  assert.strictEqual(buckets.unitCents, ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket);
  assert.strictEqual(buckets.totalCents, 3 * ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket);
});

test("alumni_bucket: max self-serve is 4 buckets", () => {
  const result = simulateAlumniBucketAdjust({
    newQuantity: 4,
    currentAlumniCount: 0,
    currentBucketQuantity: 3,
    stripeError: false,
    dbWriteError: false,
    hasBillingInterval: "year",
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(ALUMNI_BUCKET_PRICING.maxSelfServeBuckets, 4);
});

// ── Bug regression: alumni_bucket_quantity column missing from schema ──────────
//
// Root cause: billing/adjust/route.ts line 201 explicitly SELECTs
// alumni_bucket_quantity. The enterprise_subscriptions table never had this
// column — the column only has alumni_tier and pooled_alumni_limit. The SELECT
// fails with a DB error, and the route returns 500 (via the subError branch).
//
// Fix: migration 20260607000000_add_alumni_bucket_quantity.sql that adds the
// column. These tests FAIL before the migration exists and PASS after.

test("enterprise_subscriptions migration for alumni_bucket_quantity exists", () => {
  const migrationFile = path.join(
    process.cwd(),
    "supabase/migrations/20260607000000_add_alumni_bucket_quantity.sql"
  );
  assert.ok(
    existsSync(migrationFile),
    "Migration 20260607000000_add_alumni_bucket_quantity.sql must exist — without it, " +
      "billing/adjust SELECT alumni_bucket_quantity fails with 500"
  );
});

test("alumni_bucket_quantity migration targets enterprise_subscriptions with correct type", () => {
  const migrationFile = path.join(
    process.cwd(),
    "supabase/migrations/20260607000000_add_alumni_bucket_quantity.sql"
  );
  if (!existsSync(migrationFile)) {
    // Already covered by the previous test; skip gracefully
    return;
  }
  const sql = readFileSync(migrationFile, "utf-8");
  assert.ok(
    sql.toLowerCase().includes("alumni_bucket_quantity"),
    "Migration must define alumni_bucket_quantity column"
  );
  assert.ok(
    sql.toLowerCase().includes("enterprise_subscriptions"),
    "Migration must target enterprise_subscriptions table"
  );
  assert.ok(
    sql.toLowerCase().includes("integer") || sql.toLowerCase().includes("int"),
    "alumni_bucket_quantity must be an integer column"
  );
  assert.ok(
    sql.toLowerCase().includes("default 1"),
    "alumni_bucket_quantity must default to 1 so existing rows are not broken"
  );
});
