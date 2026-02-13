import test, { mock } from "node:test";
import assert from "node:assert";
import type { SyncInput, SyncResult, ScheduleConnector } from "@/lib/schedule-connectors/types";

/**
 * Tests for the schedule source sync flow.
 *
 * Validates that:
 * 1. syncScheduleSource passes connected_user_id to connectors as userId
 * 2. Google Calendar sources receive userId for OAuth token resolution
 * 3. Non-Google sources work fine without connected_user_id
 * 4. Missing connector returns error
 * 5. Source status is updated correctly on success/failure
 */

// ---- spy connector factory ----

const syncCalls: SyncInput[] = [];
let syncBehavior: "succeed" | "throw" = "succeed";
let syncError = "";

function resetSpy() {
  syncCalls.length = 0;
  syncBehavior = "succeed";
  syncError = "";
}

function createSpyConnector(vendorId: string): ScheduleConnector {
  return {
    id: vendorId as ScheduleConnector["id"],
    async canHandle() {
      return { ok: true, confidence: 1.0 };
    },
    async preview() {
      return { vendor: vendorId as ScheduleConnector["id"], events: [] };
    },
    async sync(input: SyncInput): Promise<SyncResult> {
      syncCalls.push(input);
      if (syncBehavior === "throw") {
        throw new Error(syncError);
      }
      return { imported: 3, updated: 1, cancelled: 0, vendor: vendorId as SyncResult["vendor"] };
    },
  };
}

const googleSpy = createSpyConnector("google_calendar");
const icsSpy = createSpyConnector("ics");

// Mock the registry module before importing sync-source
mock.module("@/lib/schedule-connectors/registry", {
  namedExports: {
    getConnectorById(id: string) {
      if (id === "google_calendar") return googleSpy;
      if (id === "ics") return icsSpy;
      return null;
    },
    connectors: [icsSpy, googleSpy],
    detectConnector: async () => ({ connector: icsSpy, confidence: 1.0 }),
  },
});

// Dynamic import AFTER mock is set up
const { syncScheduleSource } = await import("@/lib/schedule-connectors/sync-source");
const { createSupabaseStub } = await import("./utils/supabaseStub");

// ---- helpers ----

function makeWindow() {
  return { from: new Date("2025-01-01"), to: new Date("2025-12-31") };
}

// ---- tests ----

test("syncScheduleSource passes connected_user_id as userId to Google Calendar connector", async () => {
  resetSpy();
  const stub = createSupabaseStub();
  stub.seed("schedule_sources", [{
    id: "src-google-1",
    org_id: "org-1",
    vendor_id: "google_calendar",
    source_url: "google://cal-abc",
    connected_user_id: "user-xyz",
    status: "active",
  }]);

  const result = await syncScheduleSource(stub as never, {
    source: {
      id: "src-google-1",
      org_id: "org-1",
      vendor_id: "google_calendar",
      source_url: "google://cal-abc",
      connected_user_id: "user-xyz",
    },
    window: makeWindow(),
  });

  assert.strictEqual(result.ok, true, "sync should succeed");
  assert.strictEqual(result.imported, 3);
  assert.strictEqual(result.updated, 1);

  // Critical assertion: connected_user_id flows through as userId
  assert.strictEqual(syncCalls.length, 1, "connector.sync should be called once");
  assert.strictEqual(syncCalls[0].userId, "user-xyz",
    "connected_user_id must be passed as userId to the connector");
});

test("syncScheduleSource passes undefined userId when connected_user_id is null", async () => {
  resetSpy();
  const stub = createSupabaseStub();
  stub.seed("schedule_sources", [{
    id: "src-ics-1",
    org_id: "org-1",
    vendor_id: "ics",
    source_url: "https://example.com/cal.ics",
    connected_user_id: null,
    status: "active",
  }]);

  const result = await syncScheduleSource(stub as never, {
    source: {
      id: "src-ics-1",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://example.com/cal.ics",
      connected_user_id: null,
    },
    window: makeWindow(),
  });

  assert.strictEqual(result.ok, true, "sync should succeed for ICS without userId");
  assert.strictEqual(syncCalls.length, 1);
  assert.strictEqual(syncCalls[0].userId, undefined,
    "null connected_user_id should become undefined userId");
});

test("syncScheduleSource returns error for unsupported vendor", async () => {
  resetSpy();
  const stub = createSupabaseStub();
  stub.seed("schedule_sources", [{
    id: "src-bad-1",
    org_id: "org-1",
    vendor_id: "unknown_vendor",
    source_url: "https://example.com",
    connected_user_id: null,
    status: "active",
  }]);

  const result = await syncScheduleSource(stub as never, {
    source: {
      id: "src-bad-1",
      org_id: "org-1",
      vendor_id: "unknown_vendor",
      source_url: "https://example.com",
      connected_user_id: null,
    },
    window: makeWindow(),
  });

  assert.strictEqual(result.ok, false, "should fail for unsupported vendor");
  assert.ok(result.error?.includes("Unsupported vendor"),
    `error should mention unsupported vendor, got: ${result.error}`);

  const sources = stub.getRows("schedule_sources");
  assert.strictEqual(sources[0].status, "error");
  assert.ok(String(sources[0].last_error).includes("Unsupported vendor"));
});

test("syncScheduleSource updates source metadata on success", async () => {
  resetSpy();
  const stub = createSupabaseStub();
  stub.seed("schedule_sources", [{
    id: "src-ok-1",
    org_id: "org-1",
    vendor_id: "ics",
    source_url: "https://example.com/cal.ics",
    connected_user_id: null,
    status: "active",
    last_synced_at: null,
    last_error: "previous error",
  }]);

  const result = await syncScheduleSource(stub as never, {
    source: {
      id: "src-ok-1",
      org_id: "org-1",
      vendor_id: "ics",
      source_url: "https://example.com/cal.ics",
      connected_user_id: null,
    },
    window: makeWindow(),
  });

  assert.strictEqual(result.ok, true);

  const sources = stub.getRows("schedule_sources");
  assert.strictEqual(sources[0].status, "active");
  assert.strictEqual(sources[0].last_error, null, "last_error should be cleared on success");
  assert.ok(sources[0].last_synced_at, "last_synced_at should be set");
  assert.strictEqual(sources[0].last_event_count, 4); // 3 imported + 1 updated
});

test("syncScheduleSource records error when connector throws", async () => {
  resetSpy();
  syncBehavior = "throw";
  syncError = "Google Calendar connector requires userId (connected_user_id)";

  const stub = createSupabaseStub();
  stub.seed("schedule_sources", [{
    id: "src-fail-1",
    org_id: "org-1",
    vendor_id: "google_calendar",
    source_url: "google://cal-fail",
    connected_user_id: "user-expired",
    status: "active",
  }]);

  const result = await syncScheduleSource(stub as never, {
    source: {
      id: "src-fail-1",
      org_id: "org-1",
      vendor_id: "google_calendar",
      source_url: "google://cal-fail",
      connected_user_id: "user-expired",
    },
    window: makeWindow(),
  });

  assert.strictEqual(result.ok, false);
  assert.ok(result.error?.includes("connected_user_id"),
    `error should mention connected_user_id, got: ${result.error}`);

  const sources = stub.getRows("schedule_sources");
  assert.strictEqual(sources[0].status, "error");
  assert.ok(String(sources[0].last_error).includes("connected_user_id"));
});

test("route SELECT includes connected_user_id", async () => {
  // Verify the route file contains connected_user_id in the SELECT query
  const fs = await import("node:fs");
  const routePath = new URL(
    "../src/app/api/schedules/sources/[sourceId]/sync/route.ts",
    import.meta.url,
  );
  const routeCode = fs.readFileSync(routePath, "utf-8");

  const selectMatch = routeCode.match(/\.select\(["']([^"']+)["']\)/);
  assert.ok(selectMatch, "route should have a .select() call");

  const selectedColumns = selectMatch[1].split(",").map((c: string) => c.trim());
  assert.ok(
    selectedColumns.includes("connected_user_id"),
    `SELECT must include connected_user_id, got: ${selectMatch[1]}`,
  );
});
