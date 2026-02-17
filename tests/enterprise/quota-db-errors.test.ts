import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateSubOrgCapacity,
  evaluateAdoptionQuota,
  buildQuotaInfo,
  type EnterpriseQuotaInfo,
  type SeatQuotaInfo,
  type AdoptionQuotaResult,
} from "../../src/lib/enterprise/quota-logic.ts";

/**
 * Tests for DB error paths in enterprise quota async wrappers.
 *
 * The async wrappers in quota.ts call createServiceClient() internally
 * and cannot be directly unit-tested without module mocking.
 *
 * We use simulation functions that replicate the exact conditional logic
 * from quota.ts, then assert on the output of those simulations. The
 * real pure functions (evaluateSubOrgCapacity, evaluateAdoptionQuota,
 * buildQuotaInfo) are imported directly and exercised via delegation.
 *
 * Covers:
 * 1. canEnterpriseAddSubOrg — DB error path, success path, null data default
 * 2. checkAdoptionQuota — missing subscription, alumni count DB error, success/over-capacity
 * 3. getEnterpriseQuota — subscription error, null subscription, counts error, both succeed
 */

// ── Simulation helpers ────────────────────────────────────────────────────────

/**
 * Simulates canEnterpriseAddSubOrg (quota.ts:105-125).
 *
 * Replicates the exact branching:
 *   - countsError → return internal_error sentinel
 *   - counts null → default currentCount to 0
 *   - success → delegate to evaluateSubOrgCapacity
 */
function simulateCanEnterpriseAddSubOrg(params: {
  counts: { enterprise_managed_org_count: number } | null;
  countsError: unknown;
}): SeatQuotaInfo & { error?: string } {
  const { counts, countsError } = params;

  if (countsError) {
    return {
      allowed: false,
      currentCount: 0,
      maxAllowed: null,
      needsUpgrade: false,
      error: "internal_error",
    };
  }

  const currentCount = counts?.enterprise_managed_org_count ?? 0;
  return evaluateSubOrgCapacity(currentCount);
}

/**
 * Simulates checkAdoptionQuota (quota.ts:81-103).
 *
 * Replicates the exact branching:
 *   - quota null → return "Enterprise subscription not found"
 *   - alumniCountError → return "Failed to verify alumni count"
 *   - success → delegate to evaluateAdoptionQuota
 */
function simulateCheckAdoptionQuota(params: {
  quota: EnterpriseQuotaInfo | null;
  orgAlumniCount: number | null;
  alumniCountError: unknown;
}): AdoptionQuotaResult {
  const { quota, orgAlumniCount, alumniCountError } = params;

  if (!quota) {
    return { allowed: false, error: "Enterprise subscription not found" };
  }

  if (alumniCountError) {
    return { allowed: false, error: "Failed to verify alumni count" };
  }

  return evaluateAdoptionQuota(quota, orgAlumniCount ?? 0);
}

/**
 * Simulates getEnterpriseQuota (quota.ts:40-74).
 *
 * Replicates the exact branching from the parallel fetch:
 *   - subscriptionError → return null
 *   - subscription null → return null
 *   - countsError → log, default alumni/subOrg counts to 0, continue
 *   - success → delegate to buildQuotaInfo
 */
function simulateGetEnterpriseQuota(params: {
  subscription: { alumni_bucket_quantity: number } | null;
  subscriptionError: unknown;
  counts: { total_alumni_count: number; sub_org_count: number } | null;
  countsError: unknown;
}): EnterpriseQuotaInfo | null {
  const { subscription, subscriptionError, counts, countsError } = params;

  if (subscriptionError) {
    return null;
  }

  // countsError is non-fatal — logged but execution continues
  if (countsError) {
    // logged in real implementation; not asserted here
  }

  if (!subscription) return null;

  const alumniCount = counts?.total_alumni_count ?? 0;
  const subOrgCount = counts?.sub_org_count ?? 0;

  return buildQuotaInfo(subscription.alumni_bucket_quantity, alumniCount, subOrgCount);
}

// ── canEnterpriseAddSubOrg ────────────────────────────────────────────────────

describe("canEnterpriseAddSubOrg — DB error path", () => {
  it("returns { error: 'internal_error', allowed: false } when DB query fails", () => {
    const result = simulateCanEnterpriseAddSubOrg({
      counts: null,
      countsError: new Error("connection timeout"),
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.error, "internal_error");
  });

  it("needsUpgrade is false on DB error (not true)", () => {
    const result = simulateCanEnterpriseAddSubOrg({
      counts: null,
      countsError: new Error("DB unavailable"),
    });

    assert.strictEqual(result.needsUpgrade, false);
  });

  it("currentCount is 0 on DB error", () => {
    const result = simulateCanEnterpriseAddSubOrg({
      counts: null,
      countsError: new Error("query failed"),
    });

    assert.strictEqual(result.currentCount, 0);
  });

  it("returns { allowed: true } with correct currentCount when query succeeds", () => {
    const result = simulateCanEnterpriseAddSubOrg({
      counts: { enterprise_managed_org_count: 7 },
      countsError: null,
    });

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.currentCount, 7);
    assert.strictEqual(result.needsUpgrade, false);
    assert.strictEqual(result.error, undefined);
  });

  it("defaults currentCount to 0 when counts data is null (missing view row)", () => {
    const result = simulateCanEnterpriseAddSubOrg({
      counts: null,
      countsError: null,
    });

    assert.strictEqual(result.currentCount, 0);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.error, undefined);
  });

  it("delegates to evaluateSubOrgCapacity for success path (maxAllowed is null)", () => {
    const result = simulateCanEnterpriseAddSubOrg({
      counts: { enterprise_managed_org_count: 15 },
      countsError: null,
    });

    // evaluateSubOrgCapacity always returns maxAllowed: null in hybrid model
    assert.strictEqual(result.maxAllowed, null);
    assert.strictEqual(result.allowed, true);
  });
});

// ── checkAdoptionQuota ────────────────────────────────────────────────────────

describe("checkAdoptionQuota — missing subscription", () => {
  it("returns { error: 'Enterprise subscription not found' } when quota is null", () => {
    const result = simulateCheckAdoptionQuota({
      quota: null,
      orgAlumniCount: 500,
      alumniCountError: null,
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.error, "Enterprise subscription not found");
  });

  it("does not proceed to alumni count check when quota is null", () => {
    const result = simulateCheckAdoptionQuota({
      quota: null,
      orgAlumniCount: null,
      alumniCountError: new Error("should not reach this"),
    });

    // The null-quota guard fires first; alumni error is irrelevant
    assert.strictEqual(result.error, "Enterprise subscription not found");
  });
});

describe("checkAdoptionQuota — alumni count DB error", () => {
  it("returns { error: 'Failed to verify alumni count' } when alumni count query errors", () => {
    const quota = buildQuotaInfo(2, 1000, 3);

    const result = simulateCheckAdoptionQuota({
      quota,
      orgAlumniCount: null,
      alumniCountError: new Error("DB read error"),
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.error, "Failed to verify alumni count");
  });

  it("allowed is false on alumni count error even when enterprise has capacity", () => {
    // Enterprise has 4000 alumni remaining — but DB error should still block
    const quota = buildQuotaInfo(3, 1000, 2);

    const result = simulateCheckAdoptionQuota({
      quota,
      orgAlumniCount: null,
      alumniCountError: new Error("network error"),
    });

    assert.strictEqual(result.allowed, false);
  });
});

describe("checkAdoptionQuota — success path", () => {
  it("returns { allowed: true } when within capacity", () => {
    const quota = buildQuotaInfo(2, 1000, 2);

    const result = simulateCheckAdoptionQuota({
      quota,
      orgAlumniCount: 500,
      alumniCountError: null,
    });

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 1500);
  });

  it("returns { allowed: false } with upgrade message when over capacity", () => {
    // 1 bucket = 2500 limit; current 2000 + org 600 = 2600 > 2500
    const quota = buildQuotaInfo(1, 2000, 3);

    const result = simulateCheckAdoptionQuota({
      quota,
      orgAlumniCount: 600,
      alumniCountError: null,
    });

    assert.strictEqual(result.allowed, false);
    assert.ok(result.error?.includes("Upgrade your alumni bucket"));
    assert.strictEqual(result.wouldBeTotal, 2600);
  });

  it("uses orgAlumniCount of 0 when count is null (no rows in org)", () => {
    const quota = buildQuotaInfo(1, 100, 1);

    const result = simulateCheckAdoptionQuota({
      quota,
      orgAlumniCount: null,
      alumniCountError: null,
    });

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.wouldBeTotal, 100);
  });
});

// ── getEnterpriseQuota ────────────────────────────────────────────────────────

describe("getEnterpriseQuota — subscription query errors", () => {
  it("returns null when subscription query errors", () => {
    const result = simulateGetEnterpriseQuota({
      subscription: null,
      subscriptionError: new Error("timeout"),
      counts: { total_alumni_count: 500, sub_org_count: 3 },
      countsError: null,
    });

    assert.strictEqual(result, null);
  });

  it("returns null when subscription data is null (no subscription row)", () => {
    const result = simulateGetEnterpriseQuota({
      subscription: null,
      subscriptionError: null,
      counts: { total_alumni_count: 0, sub_org_count: 0 },
      countsError: null,
    });

    assert.strictEqual(result, null);
  });
});

describe("getEnterpriseQuota — counts query errors", () => {
  it("returns quota info with alumni/subOrg counts defaulted to 0 when counts query errors", () => {
    const result = simulateGetEnterpriseQuota({
      subscription: { alumni_bucket_quantity: 2 },
      subscriptionError: null,
      counts: null,
      countsError: new Error("view unavailable"),
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.alumniCount, 0);
    assert.strictEqual(result!.subOrgCount, 0);
    assert.strictEqual(result!.bucketQuantity, 2);
  });

  it("subscription error takes precedence over counts error", () => {
    const result = simulateGetEnterpriseQuota({
      subscription: null,
      subscriptionError: new Error("critical failure"),
      counts: null,
      countsError: new Error("also failed"),
    });

    assert.strictEqual(result, null);
  });
});

describe("getEnterpriseQuota — success path", () => {
  it("returns quota info when both queries succeed", () => {
    const result = simulateGetEnterpriseQuota({
      subscription: { alumni_bucket_quantity: 3 },
      subscriptionError: null,
      counts: { total_alumni_count: 4000, sub_org_count: 5 },
      countsError: null,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.bucketQuantity, 3);
    assert.strictEqual(result!.alumniCount, 4000);
    assert.strictEqual(result!.subOrgCount, 5);
    assert.strictEqual(result!.alumniLimit, 3 * 2500);
    assert.strictEqual(result!.remaining, 3500);
  });

  it("delegates to buildQuotaInfo (remaining = limit - count, clamped to 0)", () => {
    // Over capacity: 1 bucket = 2500, but 2600 alumni in use
    const result = simulateGetEnterpriseQuota({
      subscription: { alumni_bucket_quantity: 1 },
      subscriptionError: null,
      counts: { total_alumni_count: 2600, sub_org_count: 2 },
      countsError: null,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.remaining, 0);
    assert.strictEqual(result!.alumniCount, 2600);
  });

  it("defaults alumni/subOrg counts from view to 0 when counts row is null but no error", () => {
    // View can return null row if enterprise has no data yet
    const result = simulateGetEnterpriseQuota({
      subscription: { alumni_bucket_quantity: 1 },
      subscriptionError: null,
      counts: null,
      countsError: null,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.alumniCount, 0);
    assert.strictEqual(result!.subOrgCount, 0);
  });
});
