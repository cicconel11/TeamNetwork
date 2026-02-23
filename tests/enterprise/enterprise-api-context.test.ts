import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  getEnterpriseApiContext,
  ENTERPRISE_ANY_ROLE,
  ENTERPRISE_BILLING_ROLE,
  ENTERPRISE_CREATE_ORG_ROLE,
  ENTERPRISE_OWNER_ROLE,
} from "@/lib/auth/enterprise-api-context";
import type { RateLimitResult } from "@/lib/security/rate-limit";

/**
 * Tests for getEnterpriseApiContext() — the consolidated auth helper
 * for enterprise API routes.
 *
 * Uses dependency injection: the helper accepts a `deps` parameter
 * containing the service client and resolver, so tests can stub
 * Supabase and resolveEnterpriseParam without module-level mocking.
 */

// ── Test helpers ──

function makeRateLimitResult(overrides: Partial<RateLimitResult> = {}): RateLimitResult {
  return {
    ok: true,
    limit: 60,
    remaining: 59,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 60,
    reason: "",
    headers: {
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "59",
      "X-RateLimit-Reset": String(Math.ceil((Date.now() + 60_000) / 1000)),
    },
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-123",
    email: "test@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

type MockQueryResult = {
  data: unknown;
  error: unknown;
};

function makeMockServiceSupabase(roleResult: MockQueryResult) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(roleResult),
          }),
        }),
      }),
    }),
  };
}

function makeSuccessResolver(enterpriseId: string = "ent-uuid-123") {
  return async () => ({
    data: { enterpriseId, enterpriseSlug: null },
    error: undefined,
  });
}

function makeErrorResolver(message: string, status: number) {
  return async () => ({
    data: null,
    error: { message, status },
  });
}

// ── Tests ──

describe("getEnterpriseApiContext", () => {
  let rateLimit: RateLimitResult;

  beforeEach(() => {
    rateLimit = makeRateLimitResult();
  });

  // ── Unauthenticated ──

  describe("unauthenticated user", () => {
    it("returns { ok: false } with 401 when user is null", async () => {
      const result = await getEnterpriseApiContext(
        "ent-slug",
        null,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.response.status, 401);
        const body = await result.response.json();
        assert.strictEqual(body.error, "Unauthorized");
        // Rate-limit headers present
        assert.ok(result.response.headers.get("X-RateLimit-Limit"));
      }
    });
  });

  // ── Unresolvable slug ──

  describe("unresolvable enterprise param", () => {
    it("returns { ok: false } with 404 when slug not found", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "nonexistent-slug",
        user as any,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
          resolveEnterprise: makeErrorResolver("Enterprise not found", 404),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.response.status, 404);
      }
    });

    it("returns { ok: false } with 400 for invalid slug", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "!!invalid!!",
        user as any,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
          resolveEnterprise: makeErrorResolver("Invalid enterprise id", 400),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.response.status, 400);
      }
    });
  });

  // ── No enterprise role ──

  describe("no enterprise role", () => {
    it("returns { ok: false } with 403 when user has no role", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.response.status, 403);
      }
    });
  });

  // ── Wrong role for required level ──

  describe("wrong role for required level", () => {
    it("returns 403 when user is org_admin but owner is required", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_OWNER_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({
            data: { role: "org_admin" },
            error: null,
          }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.response.status, 403);
      }
    });

    it("returns 403 when user is org_admin but billing is required", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_BILLING_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({
            data: { role: "org_admin" },
            error: null,
          }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.response.status, 403);
      }
    });
  });

  // ── Role DB query error (fail-closed) ──

  describe("role DB query error", () => {
    it("returns { ok: false } with 503 on DB error (fail-closed as internal error)", async () => {
      // Wave 1 fix: DB errors on the role query return 503 (internal server error),
      // not 403 (forbidden) — to distinguish infra failures from permission denials.
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({
            data: null,
            error: { message: "connection timeout" },
          }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.response.status, 503);
      }
    });
  });

  // ── Success cases ──

  describe("successful auth", () => {
    it("returns { ok: true } with all fields for matching role", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({
            data: { role: "owner" },
            error: null,
          }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.enterpriseId, "ent-uuid-123");
        assert.strictEqual(result.userId, "user-123");
        assert.strictEqual(result.userEmail, "test@example.com");
        assert.strictEqual(result.role, "owner");
        assert.ok(result.serviceSupabase);
      }
    });

    it("works with billing_admin for ENTERPRISE_BILLING_ROLE", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_BILLING_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({
            data: { role: "billing_admin" },
            error: null,
          }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.role, "billing_admin");
      }
    });

    it("works with org_admin for ENTERPRISE_CREATE_ORG_ROLE", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_CREATE_ORG_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({
            data: { role: "org_admin" },
            error: null,
          }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.role, "org_admin");
      }
    });
  });

  // ── Rate-limit headers on all error responses ──

  describe("rate-limit headers", () => {
    it("includes rate-limit headers on 401", async () => {
      const result = await getEnterpriseApiContext(
        "ent-slug",
        null,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.response.headers.get("X-RateLimit-Limit"));
        assert.ok(result.response.headers.get("X-RateLimit-Remaining"));
        assert.ok(result.response.headers.get("X-RateLimit-Reset"));
      }
    });

    it("includes rate-limit headers on 403", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "ent-uuid-123",
        user as any,
        rateLimit,
        ENTERPRISE_OWNER_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
          resolveEnterprise: makeSuccessResolver(),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.response.headers.get("X-RateLimit-Limit"));
      }
    });

    it("includes rate-limit headers on 404", async () => {
      const user = makeUser();
      const result = await getEnterpriseApiContext(
        "nonexistent",
        user as any,
        rateLimit,
        ENTERPRISE_ANY_ROLE,
        {
          serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
          resolveEnterprise: makeErrorResolver("Enterprise not found", 404),
        }
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.response.headers.get("X-RateLimit-Limit"));
      }
    });
  });

  // ── Role preset constants ──

  describe("role preset constants", () => {
    it("ENTERPRISE_ANY_ROLE includes all three roles", () => {
      assert.deepStrictEqual(
        [...ENTERPRISE_ANY_ROLE].sort(),
        ["billing_admin", "org_admin", "owner"]
      );
    });

    it("ENTERPRISE_BILLING_ROLE includes owner and billing_admin", () => {
      assert.deepStrictEqual(
        [...ENTERPRISE_BILLING_ROLE].sort(),
        ["billing_admin", "owner"]
      );
    });

    it("ENTERPRISE_CREATE_ORG_ROLE includes owner and org_admin", () => {
      assert.deepStrictEqual(
        [...ENTERPRISE_CREATE_ORG_ROLE].sort(),
        ["org_admin", "owner"]
      );
    });

    it("ENTERPRISE_OWNER_ROLE includes only owner", () => {
      assert.deepStrictEqual(ENTERPRISE_OWNER_ROLE, ["owner"]);
    });
  });
});
