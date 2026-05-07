import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dedupeEvents, syncScheduleEvents, type SyncWindow } from "@/lib/schedule-connectors/storage";
import type { NormalizedEvent } from "@/lib/schedule-connectors/types";
import { createSupabaseStub } from "./utils/supabaseStub";

function makeEvent(overrides: Partial<NormalizedEvent> & { external_uid: string }): NormalizedEvent {
  return {
    title: "Event",
    start_at: new Date("2025-03-15T10:00:00Z").toISOString(),
    end_at: new Date("2025-03-15T12:00:00Z").toISOString(),
    status: "confirmed",
    ...overrides,
  };
}

function buildWindow(from: string, to: string): SyncWindow {
  return { from: new Date(from), to: new Date(to) };
}

function generateEvents(count: number, windowFrom: string, windowTo: string): NormalizedEvent[] {
  const from = new Date(windowFrom).getTime();
  const to = new Date(windowTo).getTime();
  const step = (to - from) / count;

  return Array.from({ length: count }, (_, i) => {
    const startAt = new Date(from + step * i);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    return makeEvent({
      external_uid: `evt-${String(i).padStart(4, "0")}`,
      title: `Event ${i}`,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
    });
  });
}

describe("robust schedule sync (200+ events)", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const orgId = "org-1";
  const sourceId = "source-1";
  const window = buildWindow("2025-01-01T00:00:00Z", "2025-12-31T23:59:59Z");

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("upserts 250 events without error (chunking works)", async () => {
    const events = generateEvents(250, "2025-01-01T00:00:00Z", "2025-06-30T00:00:00Z");

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.imported, 250);
    assert.equal(result.updated, 0);
    assert.equal(result.cancelled, 0);

    const rows = stub.getRows("schedule_events");
    assert.equal(rows.length, 250);
  });

  it("repeated sync of same 250 events → 0 new imports, 250 updates", async () => {
    const events = generateEvents(250, "2025-01-01T00:00:00Z", "2025-06-30T00:00:00Z");

    // First sync
    await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(stub.getRows("schedule_events").length, 250);

    // Second sync with same events
    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.imported, 0, "no new imports on re-sync");
    assert.equal(result.updated, 250, "all 250 should be updates");
    assert.equal(result.cancelled, 0, "no cancellations");

    const rows = stub.getRows("schedule_events");
    assert.equal(rows.length, 250, "row count unchanged");
  });

  it("removing 50 events from source → those 50 get cancelled", async () => {
    const allEvents = generateEvents(250, "2025-01-01T00:00:00Z", "2025-06-30T00:00:00Z");

    // First sync with all 250
    await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events: allEvents,
      window,
    });

    assert.equal(stub.getRows("schedule_events").length, 250);

    // Second sync with only the first 200 (50 removed)
    const reducedEvents = allEvents.slice(0, 200);
    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events: reducedEvents,
      window,
    });

    assert.equal(result.imported, 0, "no new imports");
    assert.equal(result.updated, 200, "200 updates");
    assert.equal(result.cancelled, 50, "50 events cancelled");

    const rows = stub.getRows("schedule_events");
    const cancelledRows = rows.filter((r) => r.status === "cancelled");
    assert.equal(cancelledRows.length, 50, "50 rows marked cancelled");

    const activeRows = rows.filter((r) => r.status !== "cancelled");
    assert.equal(activeRows.length, 200, "200 rows still active");
  });

  it("dedup: 300 events with 50 duplicate UIDs → 250 unique upserted", async () => {
    const baseEvents = generateEvents(250, "2025-01-01T00:00:00Z", "2025-06-30T00:00:00Z");

    // Add 50 duplicates (same external_uid as first 50, different titles)
    const duplicates = baseEvents.slice(0, 50).map((e) => ({
      ...e,
      title: `${e.title} (duplicate)`,
    }));

    const eventsWithDupes = [...baseEvents, ...duplicates];
    assert.equal(eventsWithDupes.length, 300, "input has 300 events");

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events: eventsWithDupes,
      window,
    });

    assert.equal(result.imported, 250, "250 unique events imported");
    assert.equal(result.updated, 0, "no updates (first sync)");
    assert.equal(result.cancelled, 0, "no cancellations");

    const rows = stub.getRows("schedule_events");
    assert.equal(rows.length, 250, "exactly 250 rows stored");

    // Verify dedup kept the last occurrence (duplicate titles for first 50)
    const first = rows.find((r) => r.external_uid === "evt-0000");
    assert.ok(first);
    assert.equal(first.title, "Event 0 (duplicate)", "dedup keeps last occurrence");
  });

  it("dedupeEvents standalone: removes duplicates keeping last", () => {
    const events = generateEvents(300, "2025-01-01T00:00:00Z", "2025-06-30T00:00:00Z");

    // Override first 50 UIDs to create duplicates
    const withDupes = [
      ...events,
      ...events.slice(0, 50).map((e) => ({ ...e, title: "dup" })),
    ];

    const result = dedupeEvents(withDupes);
    assert.equal(result.length, 300, "300 unique UIDs remain");

    // First 50 should have been replaced with "dup" title
    const first = result.find((e) => e.external_uid === "evt-0000");
    assert.ok(first);
    assert.equal(first.title, "dup");
  });
});
