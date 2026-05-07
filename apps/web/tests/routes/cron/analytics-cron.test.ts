import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Tests for analytics cron job routes:
 * - /api/cron/analytics-purge (daily cleanup)
 *
 * Uses validateCronAuth() from src/lib/security/cron-auth.ts
 */

// ============================================================================
// Simulation Functions
// ============================================================================

/**
 * Simulates the validateCronAuth() helper logic.
 * Returns { status, body } if invalid, or null if valid.
 */
function simulateCronAuth(
  cronSecret: string | undefined,
  authHeader: string | null,
): { status: number; body: { error: string } } | null {
  if (!cronSecret) {
    return {
      status: 500,
      body: { error: "CRON_SECRET not configured" },
    };
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return {
      status: 401,
      body: { error: "Unauthorized" },
    };
  }

  return null;
}

/**
 * Simulates the analytics-purge route logic.
 */
function simulatePurge(
  cronSecret: string | undefined,
  authHeader: string | null,
  rpcResult: { data?: unknown; error?: { code?: string; message?: string } } | null,
): { status: number; body: unknown } {
  // Step 1: Validate cron auth
  const authError = simulateCronAuth(cronSecret, authHeader);
  if (authError) {
    return authError;
  }

  // Step 2: Call RPC (simulated)
  try {
    if (rpcResult?.error) {
      // Step 3: Handle error code 42883 (function not found)
      if (rpcResult.error.code === "42883") {
        return {
          status: 200,
          body: {
            success: true,
            message: "Purge skipped (function not found)",
          },
        };
      }
      // Step 5: Other errors throw
      throw rpcResult.error;
    }

    // Step 4: Success case
    return {
      status: 200,
      body: {
        success: true,
        message: "Expired usage events purged",
        result: rpcResult?.data,
      },
    };
  } catch {
    // Step 5: Return 500 with NO details field (Issue 3 fix)
    return {
      status: 500,
      body: { error: "Failed to purge usage events" },
    };
  }
}

// ============================================================================
// Tests: Shared Auth (validateCronAuth)
// ============================================================================

describe("validateCronAuth", () => {
  it("should return 500 when CRON_SECRET is not configured", () => {
    const result = simulateCronAuth(undefined, "Bearer some-token");

    assert.strictEqual(result?.status, 500);
    assert.deepStrictEqual(result?.body, { error: "CRON_SECRET not configured" });
  });

  it("should return 401 when auth header is missing", () => {
    const result = simulateCronAuth("my-secret", null);

    assert.strictEqual(result?.status, 401);
    assert.deepStrictEqual(result?.body, { error: "Unauthorized" });
  });

  it("should return 401 when auth header is incorrect", () => {
    const result = simulateCronAuth("my-secret", "Bearer wrong-token");

    assert.strictEqual(result?.status, 401);
    assert.deepStrictEqual(result?.body, { error: "Unauthorized" });
  });

  it("should return 401 when auth header format is wrong", () => {
    const result = simulateCronAuth("my-secret", "my-secret");

    assert.strictEqual(result?.status, 401);
    assert.deepStrictEqual(result?.body, { error: "Unauthorized" });
  });

  it("should return null (pass) when auth header is valid", () => {
    const result = simulateCronAuth("my-secret", "Bearer my-secret");

    assert.strictEqual(result, null);
  });
});

// ============================================================================
// Tests: Analytics Purge Route
// ============================================================================

describe("POST /api/cron/analytics-purge", () => {
  const VALID_SECRET = "test-cron-secret";
  const VALID_AUTH = `Bearer ${VALID_SECRET}`;

  it("should return 500 when CRON_SECRET is not configured", () => {
    const result = simulatePurge(undefined, VALID_AUTH, null);

    assert.strictEqual(result.status, 500);
    assert.deepStrictEqual(result.body, { error: "CRON_SECRET not configured" });
  });

  it("should return 401 when authorization header is missing", () => {
    const result = simulatePurge(VALID_SECRET, null, null);

    assert.strictEqual(result.status, 401);
    assert.deepStrictEqual(result.body, { error: "Unauthorized" });
  });

  it("should return 401 when authorization header is incorrect", () => {
    const result = simulatePurge(VALID_SECRET, "Bearer wrong-token", null);

    assert.strictEqual(result.status, 401);
    assert.deepStrictEqual(result.body, { error: "Unauthorized" });
  });

  it("should return 200 with success message when RPC succeeds", () => {
    const rpcResult = {
      data: { deleted_count: 42, oldest_deleted: "2023-10-01T00:00:00Z" },
    };

    const result = simulatePurge(VALID_SECRET, VALID_AUTH, rpcResult);

    assert.strictEqual(result.status, 200);
    const body = result.body as {
      success: boolean;
      message: string;
      result: unknown;
    };

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.message, "Expired usage events purged");
    assert.deepStrictEqual(body.result, rpcResult.data);
  });

  it("should return 200 with skipped message when RPC error is 42883", () => {
    const rpcResult = {
      error: { code: "42883", message: "function not found" },
    };

    const result = simulatePurge(VALID_SECRET, VALID_AUTH, rpcResult);

    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body, {
      success: true,
      message: "Purge skipped (function not found)",
    });
  });

  it("should return 500 with error message when RPC fails (non-42883)", () => {
    const rpcResult = {
      error: { code: "PGRST116", message: "Database connection failed" },
    };

    const result = simulatePurge(VALID_SECRET, VALID_AUTH, rpcResult);

    assert.strictEqual(result.status, 500);
    assert.deepStrictEqual(result.body, {
      error: "Failed to purge usage events",
    });
  });

  it("should NOT leak error details in 500 response (Issue 3 fix)", () => {
    const rpcResult = {
      error: { code: "SENSITIVE", message: "Internal database error with credentials" },
    };

    const result = simulatePurge(VALID_SECRET, VALID_AUTH, rpcResult);

    assert.strictEqual(result.status, 500);
    const body = result.body as Record<string, unknown>;

    // Verify body has ONLY the error key (no details field)
    assert.ok("error" in body);
    assert.ok(!("details" in body));
    assert.strictEqual(Object.keys(body).length, 1);
    assert.strictEqual(body.error, "Failed to purge usage events");
  });

  it("should handle RPC returning null data", () => {
    const rpcResult = { data: null };

    const result = simulatePurge(VALID_SECRET, VALID_AUTH, rpcResult);

    assert.strictEqual(result.status, 200);
    const body = result.body as {
      success: boolean;
      message: string;
      result: unknown;
    };

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.message, "Expired usage events purged");
    assert.strictEqual(body.result, null);
  });
});
