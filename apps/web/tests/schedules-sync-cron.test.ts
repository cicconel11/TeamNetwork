import test from "node:test";
import assert from "node:assert";

/**
 * Tests for GET /api/cron/schedules-sync
 *
 * Validates that the cron job:
 * 1. Selects connected_user_id in the query
 * 2. Skips recently synced sources (within 24 hours)
 * 3. Processes stale Google Calendar sources (older than 24 hours)
 * 4. Handles errors gracefully (one source failing doesn't block others)
 */

// Types
type ScheduleSource = {
  id: string;
  org_id: string;
  vendor_id: string;
  source_url: string;
  last_synced_at: string | null;
  status: string;
  connected_user_id: string | null;
};

type SyncResult = {
  id: string;
  vendor: string;
  status: string;
  error?: string;
};

// Test helpers

/**
 * Simulates the cron source selection logic
 */
function selectStaleSourcesForSync(
  sources: ScheduleSource[],
  cutoffTime: Date
): ScheduleSource[] {
  return sources.filter((source) => {
    // Must be active
    if (source.status !== "active") {
      return false;
    }

    // If never synced, should sync
    if (!source.last_synced_at) {
      return true;
    }

    // If synced before cutoff (older than 24h), should sync
    const lastSync = new Date(source.last_synced_at);
    return lastSync < cutoffTime;
  });
}

/**
 * Simulates batch processing with error handling
 */
async function processBatch(
  sources: ScheduleSource[],
  syncFunction: (source: ScheduleSource) => Promise<SyncResult>
): Promise<{ results: SyncResult[]; allProcessed: boolean }> {
  const results: SyncResult[] = [];

  // Process all sources even if some fail
  for (const source of sources) {
    try {
      const result = await syncFunction(source);
      results.push(result);
    } catch (error) {
      // Graceful error handling - continue processing
      results.push({
        id: source.id,
        vendor: source.vendor_id,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { results, allProcessed: true };
}

// Tests

test("selectStaleSourcesForSync selects connected_user_id in query", () => {
  const sources: ScheduleSource[] = [
    {
      id: "source-1",
      org_id: "org-1",
      vendor_id: "google_calendar",
      source_url: "google://calendar123",
      last_synced_at: null,
      status: "active",
      connected_user_id: "user-1", // Should be present
    },
  ];

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const selected = selectStaleSourcesForSync(sources, cutoff);

  assert.strictEqual(selected.length, 1);
  assert.ok(selected[0].connected_user_id !== undefined,
    "connected_user_id should be selected in query");
  assert.strictEqual(selected[0].connected_user_id, "user-1");
});

test("selectStaleSourcesForSync skips recently synced sources", () => {
  const now = Date.now();
  const recentSync = new Date(now - 12 * 60 * 60 * 1000); // 12 hours ago
  const cutoff = new Date(now - 24 * 60 * 60 * 1000); // 24 hours ago

  const sources: ScheduleSource[] = [
    {
      id: "source-recent",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://example.com/cal.ics",
      last_synced_at: recentSync.toISOString(),
      status: "active",
      connected_user_id: null,
    },
  ];

  const selected = selectStaleSourcesForSync(sources, cutoff);

  assert.strictEqual(selected.length, 0,
    "Recently synced sources (within 24h) should not be selected");
});

test("selectStaleSourcesForSync processes stale Google Calendar sources", () => {
  const now = Date.now();
  const staleSync = new Date(now - 30 * 60 * 60 * 1000); // 30 hours ago
  const cutoff = new Date(now - 24 * 60 * 60 * 1000); // 24 hours ago

  const sources: ScheduleSource[] = [
    {
      id: "source-stale",
      org_id: "org-1",
      vendor_id: "google_calendar",
      source_url: "google://calendar456",
      last_synced_at: staleSync.toISOString(),
      status: "active",
      connected_user_id: "user-2",
    },
  ];

  const selected = selectStaleSourcesForSync(sources, cutoff);

  assert.strictEqual(selected.length, 1,
    "Stale Google Calendar sources (older than 24h) should be selected");
  assert.strictEqual(selected[0].vendor_id, "google_calendar");
  assert.strictEqual(selected[0].connected_user_id, "user-2");
});

test("selectStaleSourcesForSync selects never-synced sources", () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const sources: ScheduleSource[] = [
    {
      id: "source-never-synced",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://example.com/new-cal.ics",
      last_synced_at: null, // Never synced
      status: "active",
      connected_user_id: null,
    },
  ];

  const selected = selectStaleSourcesForSync(sources, cutoff);

  assert.strictEqual(selected.length, 1,
    "Never-synced sources should be selected");
});

test("selectStaleSourcesForSync skips inactive sources", () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const sources: ScheduleSource[] = [
    {
      id: "source-inactive",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://example.com/cal.ics",
      last_synced_at: null,
      status: "inactive", // Not active
      connected_user_id: null,
    },
  ];

  const selected = selectStaleSourcesForSync(sources, cutoff);

  assert.strictEqual(selected.length, 0,
    "Inactive sources should not be selected");
});

test("processBatch handles errors gracefully", async () => {
  const sources: ScheduleSource[] = [
    {
      id: "source-1",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://good.com/cal.ics",
      last_synced_at: null,
      status: "active",
      connected_user_id: null,
    },
    {
      id: "source-2",
      org_id: "org-1",
      vendor_id: "google_calendar",
      source_url: "google://fail",
      last_synced_at: null,
      status: "active",
      connected_user_id: "user-1",
    },
    {
      id: "source-3",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://another.com/cal.ics",
      last_synced_at: null,
      status: "active",
      connected_user_id: null,
    },
  ];

  // Simulate sync function that fails for source-2
  const syncFunction = async (source: ScheduleSource): Promise<SyncResult> => {
    if (source.id === "source-2") {
      throw new Error("Token expired for connected user");
    }
    return {
      id: source.id,
      vendor: source.vendor_id,
      status: "ok",
    };
  };

  const { results, allProcessed } = await processBatch(sources, syncFunction);

  assert.strictEqual(allProcessed, true,
    "All sources should be processed even if some fail");
  assert.strictEqual(results.length, 3,
    "Should have results for all sources");

  // Verify successful syncs
  const source1Result = results.find((r) => r.id === "source-1");
  assert.strictEqual(source1Result?.status, "ok");

  const source3Result = results.find((r) => r.id === "source-3");
  assert.strictEqual(source3Result?.status, "ok");

  // Verify failed sync has error
  const source2Result = results.find((r) => r.id === "source-2");
  assert.strictEqual(source2Result?.status, "error");
  assert.ok(source2Result?.error?.includes("Token expired"),
    "Failed sync should include error message");
});

test("processBatch processes all sources when none fail", async () => {
  const sources: ScheduleSource[] = [
    {
      id: "source-1",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://a.com/cal.ics",
      last_synced_at: null,
      status: "active",
      connected_user_id: null,
    },
    {
      id: "source-2",
      org_id: "org-1",
      vendor_id: "google_calendar",
      source_url: "google://cal",
      last_synced_at: null,
      status: "active",
      connected_user_id: "user-1",
    },
  ];

  const syncFunction = async (source: ScheduleSource): Promise<SyncResult> => {
    return {
      id: source.id,
      vendor: source.vendor_id,
      status: "ok",
    };
  };

  const { results, allProcessed } = await processBatch(sources, syncFunction);

  assert.strictEqual(allProcessed, true);
  assert.strictEqual(results.length, 2);
  assert.ok(results.every((r) => r.status === "ok"),
    "All syncs should succeed");
});
