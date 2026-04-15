import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";

// We test the pure logic by injecting mock dependencies
describe("getAiOrgContext", () => {
  // Helper to create mock service client
  function createMockServiceSupabase(opts: {
    role?: string;
    status?: string;
    queryError?: boolean;
  }) {
    const eqCalls: Array<{ column: string; value: unknown }> = [];

    return {
      eqCalls,
      from: (table: string) => ({
        select: () => ({
          eq: (column: string, value: unknown) => {
            eqCalls.push({ column, value });
            return {
              maybeSingle: async () => {
                if (table === "organizations") {
                  return { data: { enterprise_id: null }, error: null };
                }
                return { data: null, error: null };
              },
              eq: (innerColumn: string, innerValue: unknown) => {
                eqCalls.push({ column: innerColumn, value: innerValue });
                return {
              maybeSingle: async () => {
                if (opts.queryError) return { data: null, error: { message: "DB error" } };
                if (!opts.role) return { data: null, error: null };
                return {
                  data: { role: opts.role, status: opts.status ?? "active" },
                  error: null,
                };
              },
                };
              },
            };
          },
        }),
      }),
    };
  }

  const mockRateLimit = { ok: true as const, headers: {} as Record<string, string>, limit: 20, remaining: 19, resetAt: 0, retryAfterSeconds: 60, reason: "" };

  it("returns 401 when user is null", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const result = await getAiOrgContext("org-id", null, mockRateLimit);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
    }
  });

  it("returns 403 when user is not admin", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const mockUser = { id: "user-id", email: "test@test.com" };
    const mockServiceSupabase = createMockServiceSupabase({ role: "active_member" });
    const result = await getAiOrgContext("org-id", mockUser as unknown as User, mockRateLimit, {
      serviceSupabase: mockServiceSupabase,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 403);
    }
  });

  it("returns 403 when admin membership is not active", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const mockUser = { id: "user-id", email: "test@test.com" };
    const mockServiceSupabase = createMockServiceSupabase({ role: "admin", status: "pending" });
    const result = await getAiOrgContext("org-id", mockUser as unknown as User, mockRateLimit, {
      serviceSupabase: mockServiceSupabase,
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
    const result = await getAiOrgContext("org-id", mockUser as unknown as User, mockRateLimit, {
      serviceSupabase: mockServiceSupabase,
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
    const result = await getAiOrgContext("org-id", mockUser as unknown as User, mockRateLimit, {
      serviceSupabase: mockServiceSupabase,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.orgId, "org-id");
      assert.equal(result.userId, "user-id");
      assert.equal(result.role, "admin");
      assert.ok(result.serviceSupabase);
    }
  });

  it("queries membership using organization_id", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const mockUser = { id: "user-id", email: "admin@test.com" };
    const mockServiceSupabase = createMockServiceSupabase({ role: "admin" });

    await getAiOrgContext("org-id", mockUser as unknown as User, mockRateLimit, {
      serviceSupabase: mockServiceSupabase,
    });

    assert.deepEqual(mockServiceSupabase.eqCalls, [
      { column: "user_id", value: "user-id" },
      { column: "organization_id", value: "org-id" },
      { column: "id", value: "org-id" },
    ]);
  });
});
