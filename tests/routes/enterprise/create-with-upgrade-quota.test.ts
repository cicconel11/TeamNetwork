import test from "node:test";
import assert from "node:assert";

/**
 * Tests for create-with-upgrade route quota handling:
 * - Pre-creation seatQuota.error → 503
 * - Post-creation updatedQuota.error → 201 with subscription: null fallback
 *
 * Simulates the logic in create-with-upgrade/route.ts
 */

interface SeatQuotaInfo {
  currentCount: number;
  maxAllowed: number | null;
  error?: string;
}

interface CreateWithUpgradeResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates the pre-creation and post-creation quota checks
 * in create-with-upgrade/route.ts.
 */
function simulateCreateWithUpgrade(
  preCreationQuota: SeatQuotaInfo,
  postCreationQuota: SeatQuotaInfo | null
): CreateWithUpgradeResult {
  // Pre-creation check: only error means infra failure (503)
  if (preCreationQuota.error) {
    return {
      status: 503,
      body: { error: "Unable to verify seat limit. Please try again." },
    };
  }

  // ... org creation happens here (always succeeds in this simulation) ...

  // Post-creation quota fetch for response (lines 193-201 in route)
  if (!postCreationQuota || postCreationQuota.error) {
    return {
      status: 201,
      body: {
        organization: { id: "new-org" },
        upgraded: false,
        subscription: null,
      },
    };
  }

  return {
    status: 201,
    body: {
      organization: { id: "new-org" },
      upgraded: false,
      subscription: {
        currentCount: postCreationQuota.currentCount,
        maxAllowed: postCreationQuota.maxAllowed,
      },
    },
  };
}

test("returns 503 when pre-creation quota check has infra error", () => {
  const result = simulateCreateWithUpgrade(
    { currentCount: 0, maxAllowed: null, error: "internal_error" },
    null
  );
  assert.strictEqual(result.status, 503);
  assert.ok((result.body.error as string).includes("Unable to verify"));
});

test("returns 201 with subscription: null when post-creation quota fetch fails", () => {
  const result = simulateCreateWithUpgrade(
    { currentCount: 3, maxAllowed: null },
    { currentCount: 4, maxAllowed: null, error: "internal_error" }
  );
  assert.strictEqual(result.status, 201);
  assert.strictEqual(result.body.subscription, null);
  assert.ok(result.body.organization);
});

test("returns 201 with full subscription info on success", () => {
  const result = simulateCreateWithUpgrade(
    { currentCount: 3, maxAllowed: null },
    { currentCount: 4, maxAllowed: null }
  );
  assert.strictEqual(result.status, 201);
  assert.ok(result.body.subscription !== null);
  assert.strictEqual(
    (result.body.subscription as Record<string, unknown>).currentCount,
    4
  );
});

test("pre-creation check runs before post-creation check", () => {
  // Even if post-creation would succeed, a pre-creation error blocks creation
  const result = simulateCreateWithUpgrade(
    { currentCount: 0, maxAllowed: null, error: "internal_error" },
    { currentCount: 1, maxAllowed: null }
  );
  assert.strictEqual(result.status, 503);
});
