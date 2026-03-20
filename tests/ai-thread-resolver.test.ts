import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("resolveOwnThread", () => {
  function createMockSupabase(opts: { thread?: any; error?: any }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => {
                if (opts.error) return { data: null, error: opts.error };
                return { data: opts.thread ?? null, error: null };
              },
            }),
          }),
        }),
      }),
    };
  }

  it("returns ok for valid thread ownership", async () => {
    const { resolveOwnThread } = await import("../src/lib/ai/thread-resolver.ts");
    const thread = { id: "t1", user_id: "u1", org_id: "o1", surface: "general", title: "Test" };
    const mock = createMockSupabase({ thread });
    const result = await resolveOwnThread("t1", "u1", "o1", mock as any);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.thread, thread);
  });

  it("returns 404 when thread not found", async () => {
    const { resolveOwnThread } = await import("../src/lib/ai/thread-resolver.ts");
    const mock = createMockSupabase({ thread: null });
    const result = await resolveOwnThread("t1", "u1", "o1", mock as any);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("returns 404 for wrong user ownership", async () => {
    const { resolveOwnThread } = await import("../src/lib/ai/thread-resolver.ts");
    const thread = { id: "t1", user_id: "other-user", org_id: "o1", surface: "general", title: null };
    const mock = createMockSupabase({ thread });
    const result = await resolveOwnThread("t1", "u1", "o1", mock as any);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("returns 404 for wrong org ownership", async () => {
    const { resolveOwnThread } = await import("../src/lib/ai/thread-resolver.ts");
    const thread = { id: "t1", user_id: "u1", org_id: "other-org", surface: "general", title: null };
    const mock = createMockSupabase({ thread });
    const result = await resolveOwnThread("t1", "u1", "o1", mock as any);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("returns 404 on query error (never leak existence)", async () => {
    const { resolveOwnThread } = await import("../src/lib/ai/thread-resolver.ts");
    const mock = createMockSupabase({ error: { message: "DB error" } });
    const result = await resolveOwnThread("t1", "u1", "o1", mock as any);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });
});
