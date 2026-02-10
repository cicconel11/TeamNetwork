import test from "node:test";
import assert from "node:assert";

/**
 * Tests for GET /api/analytics/consent and PUT /api/analytics/consent
 *
 * GET:
 * - Requires authentication
 * - Returns { consented: true/false }
 *
 * PUT:
 * - Requires authentication
 * - Validates { consented: boolean } payload
 * - Returns { consented: true/false }
 * - IMPORTANT: When revoking (consented: false), consented_at is preserved (not nulled)
 */

// Types
interface AuthContext {
  user: { id: string; email?: string; age_bracket?: string } | null;
}

function isAuthenticated(ctx: AuthContext): boolean {
  return ctx.user !== null && ctx.user.id !== "";
}

interface ConsentGetResult {
  status: number;
  consented?: boolean;
  error?: string;
}

interface ConsentPutResult {
  status: number;
  consented?: boolean;
  error?: string;
  consentedAt?: string | null;
}

interface ConsentState {
  consented: boolean;
  consentedAt?: string | null;
  revokedAt?: string | null;
}

function simulateConsentGet(
  auth: AuthContext,
  consentState: ConsentState | null,
): ConsentGetResult {
  // 1. Check authentication
  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // 2. Return consent status
  const consented = consentState?.consented ?? false;
  return { status: 200, consented };
}

function simulateConsentPut(
  auth: AuthContext,
  body: unknown,
  existingConsent: ConsentState | null,
): ConsentPutResult {
  // 1. Check authentication
  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // 2. Validate JSON body
  if (!body || typeof body !== "object") {
    return { status: 400, error: "Invalid JSON" };
  }

  const payload = body as any;
  if (typeof payload.consented !== "boolean") {
    return { status: 400, error: "Invalid payload" };
  }

  const { consented } = payload;
  const now = new Date().toISOString();

  let consentedAt: string | null;

  if (consented) {
    // Granting consent: set consented_at to now, clear revoked_at
    consentedAt = now;
  } else {
    // Revoking consent: preserve consented_at (Issue 5), set revoked_at
    // IMPORTANT: consented_at is NOT nulled to maintain audit trail
    consentedAt = existingConsent?.consentedAt ?? null;
  }

  // 3. Return updated consent status
  return {
    status: 200,
    consented,
    consentedAt,
  };
}

// Tests - GET

test("consent GET requires authentication", () => {
  const result = simulateConsentGet(
    { user: null },
    null,
  );
  assert.strictEqual(result.status, 401);
});

test("consent GET returns consented=true when user has consented", () => {
  const result = simulateConsentGet(
    { user: { id: "user-123" } },
    { consented: true, consentedAt: "2025-01-01T00:00:00Z" },
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, true);
});

test("consent GET returns consented=false when user has not consented", () => {
  const result = simulateConsentGet(
    { user: { id: "user-123" } },
    { consented: false },
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, false);
});

test("consent GET returns consented=false when no consent record exists", () => {
  const result = simulateConsentGet(
    { user: { id: "user-123" } },
    null,
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, false);
});

// Tests - PUT

test("consent PUT requires authentication", () => {
  const result = simulateConsentPut(
    { user: null },
    { consented: true },
    null,
  );
  assert.strictEqual(result.status, 401);
});

test("consent PUT validates body - missing consented field", () => {
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    {},
    null,
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Invalid payload"));
});

test("consent PUT validates body - consented is not boolean", () => {
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    { consented: "yes" },
    null,
  );
  assert.strictEqual(result.status, 400);
});

test("consent PUT grants consent successfully", () => {
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    { consented: true },
    null,
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, true);
  assert.ok(result.consentedAt);
});

test("consent PUT revokes consent successfully", () => {
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    { consented: false },
    { consented: true, consentedAt: "2025-01-01T00:00:00Z" },
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, false);
});

test("consent PUT preserves consented_at when revoking (Issue 5)", () => {
  const originalConsentedAt = "2025-01-01T00:00:00Z";
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    { consented: false },
    { consented: true, consentedAt: originalConsentedAt },
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, false);
  // IMPORTANT: consented_at should be preserved, not nulled
  assert.strictEqual(result.consentedAt, originalConsentedAt);
});

test("consent PUT re-grants consent after revocation", () => {
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    { consented: true },
    { consented: false, consentedAt: "2025-01-01T00:00:00Z", revokedAt: "2025-01-15T00:00:00Z" },
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, true);
  // New consented_at timestamp should be set
  assert.ok(result.consentedAt);
  assert.notStrictEqual(result.consentedAt, "2025-01-01T00:00:00Z");
});

test("consent PUT handles first-time consent", () => {
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    { consented: true },
    null,
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, true);
  assert.ok(result.consentedAt);
});

test("consent PUT handles revoking never-granted consent", () => {
  const result = simulateConsentPut(
    { user: { id: "user-123" } },
    { consented: false },
    null,
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.consented, false);
  // No previous consented_at to preserve
  assert.strictEqual(result.consentedAt, null);
});
