import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for sync concurrency guard edge cases in runSync().
 *
 * Covers:
 * 1. Unique violation → returns "Sync already in progress" (existing behavior)
 * 2. Non-unique INSERT error → returns error (fail-closed, not fail-open)
 * 3. Stale lock recovery → debugLog called with "released stale sync lock"
 * 4. Stale lock recovery + retry fails → returns error
 */

// Capture debugLog calls by patching the module at load time via env
// Since debugLog is a no-op unless NEXT_PUBLIC_DEBUG=true, we need to
// intercept the actual calls. We'll use a module-level override approach:
// replace the module registry entry for @/lib/debug before importing sync.

const debugCalls: Array<{ tag: string; args: unknown[] }> = [];

// We patch require/import resolution by overriding the debug module
// before importing sync. In Node's test runner with ESM-via-loader,
// we can do this by monkey-patching after import.
// Instead, we'll call runSync and verify behavior via return values for
// tests 1, 2, 4, and for test 3 we verify via the stale lock flow
// observable side effects (the update call being made).

describe("runSync concurrency guard", () => {
  // Track all supabase method calls for assertion
  let supabaseUpdateCalls: Array<{ table: string; data: any }> = [];

  function makeChain(
    table: string,
    singleResult: { data: any; error: any }
  ): any {
    const chain: any = {
      select: () => chain,
      insert: () => chain,
      update: (data: any) => {
        supabaseUpdateCalls.push({ table, data });
        return chain;
      },
      eq: () => chain,
      single: () => Promise.resolve(singleResult),
      limit: () => chain,
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    return chain;
  }

  it("Test 1: unique violation returns 'Sync already in progress'", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    supabaseUpdateCalls = [];

    // A fresh running sync (not stale) — started 1 minute ago
    const recentStartedAt = new Date(Date.now() - 60_000).toISOString();
    let callIndex = 0;

    const fakeSupabase = {
      from: (table: string) => {
        if (table === "integration_sync_log") {
          callIndex++;
          if (callIndex === 1) {
            // First call: INSERT → unique violation
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () =>
                Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "unique violation" },
                }),
              limit: () => chain,
              then: (resolve: any) => resolve({ data: [], error: null }),
            };
            return chain;
          } else {
            // Second call: SELECT running syncs → returns a fresh (non-stale) running sync
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () => Promise.resolve({ data: null, error: null }),
              limit: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [{ id: "running-sync-1", started_at: recentStartedAt }],
                  error: null,
                }),
            };
            return chain;
          }
        }
        return makeChain(table, { data: null, error: null });
      },
    };

    const fakeClient = {
      getList: async () => ({ count: 0, value: [] }),
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "full",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, false, "should return ok: false");
    assert.equal(result.error, "Sync already in progress", "should return correct error message");
    assert.equal(result.created, 0);
    assert.equal(result.updated, 0);
  });

  it("Test 2: non-unique INSERT error → fail-closed, returns error", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    supabaseUpdateCalls = [];

    const fakeSupabase = {
      from: (table: string) => {
        if (table === "integration_sync_log") {
          // INSERT fails with non-unique error (e.g. connection error, constraint other than 23505)
          const chain: any = {
            select: () => chain,
            insert: () => chain,
            update: (data: any) => {
              supabaseUpdateCalls.push({ table, data });
              return chain;
            },
            eq: () => chain,
            single: () =>
              Promise.resolve({
                data: null,
                error: { code: "08006", message: "connection failure" },
              }),
            limit: () => chain,
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
          return chain;
        }
        return makeChain(table, { data: null, error: null });
      },
    };

    const fakeClient = {
      getList: async () => ({ count: 0, value: [] }),
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "full",
      lastSyncedAt: null,
    });

    // FAIL-CLOSED: must NOT proceed with sync, must return an error
    assert.equal(result.ok, false, "should return ok: false on non-unique INSERT error");
    assert.ok(
      result.error?.includes("Failed to acquire sync lock"),
      `error should mention 'Failed to acquire sync lock', got: "${result.error}"`
    );
    assert.equal(result.created, 0, "should not have created any records");
  });

  it("Test 3: stale lock recovery → update called on stale sync log", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    supabaseUpdateCalls = [];

    // Stale running sync: started 31 minutes ago (> 30 min threshold)
    const staleStartedAt = new Date(Date.now() - 31 * 60_000).toISOString();
    let callIndex = 0;
    let retryInsertCalled = false;

    const fakeSupabase = {
      from: (table: string) => {
        if (table === "integration_sync_log") {
          callIndex++;

          if (callIndex === 1) {
            // First call: INSERT → unique violation
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () =>
                Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "unique violation" },
                }),
              limit: () => chain,
              then: (resolve: any) => resolve({ data: [], error: null }),
            };
            return chain;
          } else if (callIndex === 2) {
            // Second call: SELECT running syncs → stale sync
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () => Promise.resolve({ data: null, error: null }),
              limit: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [{ id: "stale-sync-1", started_at: staleStartedAt }],
                  error: null,
                }),
            };
            return chain;
          } else if (callIndex === 3) {
            // Third call: UPDATE stale sync to failed
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () => Promise.resolve({ data: null, error: null }),
              limit: () => chain,
              then: (resolve: any) => resolve({ data: null, error: null }),
            };
            return chain;
          } else {
            // Fourth call: retry INSERT → success
            retryInsertCalled = true;
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () =>
                Promise.resolve({ data: { id: "new-sync-log-1" }, error: null }),
              limit: () => chain,
              then: (resolve: any) => resolve({ data: [], error: null }),
            };
            return chain;
          }
        }
        // org_integrations update
        return makeChain(table, { data: null, error: null });
      },
    };

    const fakeClient = {
      getList: async () => ({ count: 0, value: [] }),
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "full",
      lastSyncedAt: null,
    });

    // Verify stale lock was updated (marked as failed)
    const staleUpdateCall = supabaseUpdateCalls.find(
      (c) => c.table === "integration_sync_log" && c.data?.status === "failed"
    );
    assert.ok(
      staleUpdateCall,
      "should have updated the stale sync log to failed status"
    );
    assert.equal(
      staleUpdateCall?.data?.error_message,
      "Stale lock released",
      "stale lock update should have error_message 'Stale lock released'"
    );

    // Verify retry INSERT was called
    assert.ok(retryInsertCalled, "should have retried the INSERT after releasing stale lock");

    // Verify sync completed successfully
    assert.equal(result.ok, true, "sync should succeed after releasing stale lock");
  });

  it("Test 4: stale lock recovery + retry INSERT fails → returns error", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    supabaseUpdateCalls = [];

    // Stale running sync: started 31 minutes ago
    const staleStartedAt = new Date(Date.now() - 31 * 60_000).toISOString();
    let callIndex = 0;

    const fakeSupabase = {
      from: (table: string) => {
        if (table === "integration_sync_log") {
          callIndex++;

          if (callIndex === 1) {
            // First call: INSERT → unique violation
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () =>
                Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "unique violation" },
                }),
              limit: () => chain,
              then: (resolve: any) => resolve({ data: [], error: null }),
            };
            return chain;
          } else if (callIndex === 2) {
            // Second call: SELECT running syncs → stale sync
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () => Promise.resolve({ data: null, error: null }),
              limit: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [{ id: "stale-sync-2", started_at: staleStartedAt }],
                  error: null,
                }),
            };
            return chain;
          } else if (callIndex === 3) {
            // Third call: UPDATE stale sync to failed
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () => Promise.resolve({ data: null, error: null }),
              limit: () => chain,
              then: (resolve: any) => resolve({ data: null, error: null }),
            };
            return chain;
          } else {
            // Fourth call: retry INSERT → fails again
            const chain: any = {
              select: () => chain,
              insert: () => chain,
              update: (data: any) => {
                supabaseUpdateCalls.push({ table, data });
                return chain;
              },
              eq: () => chain,
              single: () =>
                Promise.resolve({
                  data: null,
                  error: { code: "23505", message: "still locked" },
                }),
              limit: () => chain,
              then: (resolve: any) => resolve({ data: [], error: null }),
            };
            return chain;
          }
        }
        return makeChain(table, { data: null, error: null });
      },
    };

    const fakeClient = {
      getList: async () => ({ count: 0, value: [] }),
    };

    const result = await runSync({
      client: fakeClient as any,
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "full",
      lastSyncedAt: null,
    });

    assert.equal(result.ok, false, "should return ok: false when retry INSERT fails");
    assert.equal(
      result.error,
      "Sync already in progress",
      "should return 'Sync already in progress' when retry fails"
    );
    assert.equal(result.created, 0, "should not have created any records");
  });
});
