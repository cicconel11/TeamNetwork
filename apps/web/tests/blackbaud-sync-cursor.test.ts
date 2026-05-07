import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Verifies that runSync captures the cursor (syncStartedAt) BEFORE pagination,
 * not after. We stub the client and supabase to observe what value is written
 * to org_integrations.last_synced_at.
 */
describe("runSync cursor timing", () => {
  it("sets last_synced_at to a timestamp captured before pagination, not after", async () => {
    const { runSync } = await import("../src/lib/blackbaud/sync");

    let capturedLastSyncedAt: string | null = null;
    const PAGE_DELAY_MS = 100;

    // Stub Blackbaud client: returns one page then empty
    let callCount = 0;
    const fakeClient = {
      getList: async () => {
        callCount++;
        if (callCount === 1) {
          // First call: constituents page
          await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
          return { count: 1, value: [{ id: "c1", type: "Individual", first: "A", last: "B" }] };
        }
        if (callCount === 2) {
          // Second call: email sub-resource for constituent c1
          return { count: 0, value: [] };
        }
        // Third call: empty page (end of pagination)
        return { count: 0, value: [] };
      },
    };

    // Minimal supabase stub that captures the update to org_integrations
    const fakeSupabase = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          insert: () => chain,
          update: (data: any) => {
            if (table === "org_integrations" && data.last_synced_at) {
              capturedLastSyncedAt = data.last_synced_at;
            }
            return chain;
          },
          delete: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: { id: "sync-log-1" }, error: null }),
          limit: () => chain,
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    };

    const beforeSync = new Date();

    await runSync({
      client: fakeClient as any,
      supabase: fakeSupabase as any,
      integrationId: "int-1",
      organizationId: "org-1",
      alumniLimit: null,
      currentAlumniCount: 0,
      syncType: "full",
      lastSyncedAt: null,
    });

    const afterSync = new Date();

    assert.ok(capturedLastSyncedAt, "last_synced_at should have been set");

    const cursorTime = new Date(capturedLastSyncedAt!).getTime();

    // The cursor should have been captured BEFORE the page delay,
    // so it should be closer to beforeSync than afterSync.
    // With the delay, afterSync - cursorTime should be >= PAGE_DELAY_MS
    // if the cursor was captured before pagination.
    assert.ok(
      cursorTime <= afterSync.getTime(),
      "cursor should not be in the future"
    );
    assert.ok(
      cursorTime >= beforeSync.getTime(),
      "cursor should be after test start"
    );

    // Key assertion: cursor was captured before the page delay
    // so it should be at most a few ms after beforeSync, not near afterSync
    const cursorLag = afterSync.getTime() - cursorTime;
    assert.ok(
      cursorLag >= PAGE_DELAY_MS * 0.8,
      `cursor should have been captured before pagination (lag: ${cursorLag}ms, expected >= ${PAGE_DELAY_MS * 0.8}ms)`
    );
  });
});
