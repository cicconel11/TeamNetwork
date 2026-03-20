import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We test the pure logic by injecting mock dependencies
describe("getAiOrgContext", () => {
  // Helper to create mock service client
  function createMockServiceSupabase(opts: { role?: string; queryError?: boolean }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (opts.queryError) return { data: null, error: { message: "DB error" } };
                if (!opts.role) return { data: null, error: null };
                return { data: { role: opts.role }, error: null };
              },
            }),
          }),
        }),
      }),
    };
  }

  const mockRateLimit = { ok: true as const, headers: {} as any, limit: 20, remaining: 19, resetAt: 0, retryAfterSeconds: 60, reason: "" };

  it("returns 401 when user is null", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const result = await getAiOrgContext("org-id", null as any, mockRateLimit);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
    }
  });

  it("returns 403 when user is not admin", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const mockUser = { id: "user-id", email: "test@test.com" };
    const mockServiceSupabase = createMockServiceSupabase({ role: "active_member" });
    const result = await getAiOrgContext("org-id", mockUser as any, mockRateLimit, {
      serviceSupabase: mockServiceSupabase as any,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 403);
    }
  });

  it("returns 503 on query error (fail-closed)", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const mockUser = { id: "user-id", email: "test@test.com" };
    const mockServiceSupabase = createMockServiceSupabase({ queryError: true });
    const result = await getAiOrgContext("org-id", mockUser as any, mockRateLimit, {
      serviceSupabase: mockServiceSupabase as any,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 503);
    }
  });

  it("returns ok context for admin user", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const mockUser = { id: "user-id", email: "admin@test.com" };
    const mockServiceSupabase = createMockServiceSupabase({ role: "admin" });
    const result = await getAiOrgContext("org-id", mockUser as any, mockRateLimit, {
      serviceSupabase: mockServiceSupabase as any,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.orgId, "org-id");
      assert.equal(result.userId, "user-id");
      assert.equal(result.role, "admin");
      assert.ok(result.serviceSupabase);
    }
  });
});
