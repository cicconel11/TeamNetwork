/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { RateLimitResult } from "@/lib/security/rate-limit";

/**
 * Tests for getEnterpriseAiContext — AI-specific enterprise auth helper.
 *
 * Mirrors pattern of getAiOrgContext + getEnterpriseApiContext:
 *  - Resolves enterprise by UUID or slug (delegates to resolveEnterpriseParam)
 *  - Requires user_enterprise_roles row with role in ENTERPRISE_ANY_ROLE
 *    (owner | billing_admin | org_admin)
 *  - Fail-closed on DB error → 503
 *  - Uses discriminated union { ok: true, ... } | { ok: false, response }
 *
 * Phase 1 security requirement: a user without a role row for this enterprise
 * MUST receive 403, never 200.
 */

// ── Test helpers ──

function makeRateLimitResult(overrides: Partial<RateLimitResult> = {}): RateLimitResult {
  return {
    ok: true,
    limit: 20,
    remaining: 19,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 60,
    reason: "",
    headers: {
      "X-RateLimit-Limit": "20",
      "X-RateLimit-Remaining": "19",
      "X-RateLimit-Reset": String(Math.ceil((Date.now() + 60_000) / 1000)),
    },
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-123",
    email: "admin@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockServiceSupabase(roleResult: { data: unknown; error: unknown }) {
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

function makeSuccessResolver(enterpriseId = "ent-uuid-123") {
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

describe("getEnterpriseAiContext", () => {
  let rateLimit: RateLimitResult;

  beforeEach(() => {
    rateLimit = makeRateLimitResult();
  });

  it("returns 401 when user is null", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext("ent-slug", null, rateLimit, {
      serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
      resolveEnterprise: makeSuccessResolver(),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
      assert.ok(result.response.headers.get("X-RateLimit-Limit"));
    }
  });

  it("returns 404 when slug cannot be resolved", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "nonexistent-slug",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
        resolveEnterprise: makeErrorResolver("Enterprise not found", 404),
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 404);
    }
  });

  it("returns 400 for invalid slug format", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "!!bad!!",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
        resolveEnterprise: makeErrorResolver("Invalid enterprise id", 400),
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 400);
    }
  });

  it("returns 403 when user has no enterprise role (cross-enterprise attack)", async () => {
    // A user with a role in Enterprise 1 hitting an Enterprise 2 endpoint:
    // the role query returns no row for (user_id, enterprise_id = E2), so 403.
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "ent-uuid-123",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
        resolveEnterprise: makeSuccessResolver(),
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 403);
    }
  });

  it("returns 403 when user role is outside ENTERPRISE_ANY_ROLE", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    // A fabricated role value that isn't one of owner/billing_admin/org_admin.
    const result = await getEnterpriseAiContext(
      "ent-uuid-123",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({
          data: { role: "guest" },
          error: null,
        }),
        resolveEnterprise: makeSuccessResolver(),
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 403);
    }
  });

  it("returns 503 on role DB error (fail-closed)", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "ent-uuid-123",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({
          data: null,
          error: { message: "connection timeout" },
        }),
        resolveEnterprise: makeSuccessResolver(),
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 503);
    }
  });

  it("returns ok context for owner", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "ent-uuid-123",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({
          data: { role: "owner" },
          error: null,
        }),
        resolveEnterprise: makeSuccessResolver(),
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.enterpriseId, "ent-uuid-123");
      assert.equal(result.userId, "user-123");
      assert.equal(result.userEmail, "admin@example.com");
      assert.equal(result.role, "owner");
      assert.ok(result.serviceSupabase);
    }
  });

  it("returns ok context for billing_admin", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "ent-uuid-123",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({
          data: { role: "billing_admin" },
          error: null,
        }),
        resolveEnterprise: makeSuccessResolver(),
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.role, "billing_admin");
    }
  });

  it("returns ok context for org_admin", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "ent-uuid-123",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({
          data: { role: "org_admin" },
          error: null,
        }),
        resolveEnterprise: makeSuccessResolver(),
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.role, "org_admin");
    }
  });

  it("passes resolved enterpriseId (not raw slug) to downstream callers", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const resolved = "resolved-uuid-abc";
    const result = await getEnterpriseAiContext(
      "some-slug",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({
          data: { role: "owner" },
          error: null,
        }),
        resolveEnterprise: makeSuccessResolver(resolved),
      }
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.enterpriseId, resolved);
    }
  });

  it("includes rate-limit headers on all error responses", async () => {
    const { getEnterpriseAiContext } = await import("../src/lib/ai/enterprise-context.ts");
    const result = await getEnterpriseAiContext(
      "ent-uuid-123",
      makeUser() as any,
      rateLimit,
      {
        serviceSupabase: makeMockServiceSupabase({ data: null, error: null }),
        resolveEnterprise: makeSuccessResolver(),
      }
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.response.headers.get("X-RateLimit-Limit"));
      assert.ok(result.response.headers.get("X-RateLimit-Remaining"));
      assert.ok(result.response.headers.get("X-RateLimit-Reset"));
    }
  });
});
