import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { extractBalancedJson, extractTableEvents, hashEventId } from "@/lib/schedule-connectors/html-utils";
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

describe("extractBalancedJson", () => {
  it("extracts flat JSON after prefix", () => {
    const html = `<script>window.__DATA__ = {"events": [{"title": "Game"}]};</script>`;
    const result = extractBalancedJson(html, /window\.__DATA__\s*=\s*/) as { events: unknown[] };
    assert.ok(result);
    assert.equal(result.events.length, 1);
  });

  it("handles nested braces that would truncate non-greedy regex", () => {
    const html = `<script>window.__SCHEDULE_DATA__ = {"events": [{"title": "Game", "venue": {"name": "Gym", "address": {"city": "NYC"}}}]};</script>`;
    const result = extractBalancedJson(html, /window\.__SCHEDULE_DATA__\s*=\s*/) as {
      events: Array<{ title: string; venue: { name: string; address: { city: string } } }>;
    };
    assert.ok(result, "should extract despite nested braces");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].venue.name, "Gym");
    assert.equal(result.events[0].venue.address.city, "NYC");
  });

  it("handles strings containing braces", () => {
    const html = `window.__DATA__ = {"events": [{"title": "Game {1} vs {2}"}]};`;
    const result = extractBalancedJson(html, /window\.__DATA__\s*=\s*/) as { events: Array<{ title: string }> };
    assert.ok(result);
    assert.equal(result.events[0].title, "Game {1} vs {2}");
  });

  it("handles escaped quotes inside strings", () => {
    const html = `window.__DATA__ = {"events": [{"title": "He said \\"hello\\""}]};`;
    const result = extractBalancedJson(html, /window\.__DATA__\s*=\s*/) as { events: Array<{ title: string }> };
    assert.ok(result);
    assert.equal(result.events[0].title, 'He said "hello"');
  });

  it("returns null for missing prefix", () => {
    const html = `<script>var x = 1;</script>`;
    const result = extractBalancedJson(html, /window\.__DATA__\s*=\s*/);
    assert.equal(result, null);
  });

  it("returns null for unbalanced braces", () => {
    const html = `window.__DATA__ = {"events": [{"title": "incomplete"`;
    const result = extractBalancedJson(html, /window\.__DATA__\s*=\s*/);
    assert.equal(result, null);
  });

  it("returns null when prefix is not followed by {", () => {
    const html = `window.__DATA__ = ["not", "an", "object"];`;
    const result = extractBalancedJson(html, /window\.__DATA__\s*=\s*/);
    assert.equal(result, null);
  });

  it("extracts multiple events with deeply nested venues", () => {
    const data = {
      events: [
        { title: "Game A", venue: { name: "Arena", config: { seating: { rows: 50 } } } },
        { title: "Game B", venue: { name: "Field", config: { seating: { rows: 20 } } } },
        { title: "Game C", venue: { name: "Court" } },
      ],
    };
    const html = `<script>window.__SCHEDULE_DATA__ = ${JSON.stringify(data)};</script>`;
    const result = extractBalancedJson(html, /window\.__SCHEDULE_DATA__\s*=\s*/) as typeof data;
    assert.ok(result);
    assert.equal(result.events.length, 3);
    assert.equal(result.events[0].venue.config.seating.rows, 50);
  });
});

describe("hash-based dedup with rowIndex", () => {
  it("same title/time/location but different rowIndex produce different hashes", () => {
    const hash1 = hashEventId("Practice|2025-03-15T10:00:00.000Z|Gym|0");
    const hash2 = hashEventId("Practice|2025-03-15T10:00:00.000Z|Gym|1");
    assert.notEqual(hash1, hash2, "different rowIndex should yield different hashes");
  });

  it("same rowIndex produces same hash", () => {
    const hash1 = hashEventId("Practice|2025-03-15T10:00:00.000Z|Gym|0");
    const hash2 = hashEventId("Practice|2025-03-15T10:00:00.000Z|Gym|0");
    assert.equal(hash1, hash2);
  });

  it("extractTableEvents assigns rowIndex to each event", () => {
    const html = `
      <table>
        <thead><tr><th>Date</th><th>Event</th><th>Location</th></tr></thead>
        <tbody>
          <tr><td>March 15, 2025 10:00 AM</td><td>Practice</td><td>Gym</td></tr>
          <tr><td>March 22, 2025 10:00 AM</td><td>Practice</td><td>Gym</td></tr>
        </tbody>
      </table>
    `;
    const events = extractTableEvents(html);
    assert.equal(events.length, 2);
    assert.equal(events[0].rowIndex, 0);
    assert.equal(events[1].rowIndex, 1);
  });
});

describe("dedupeEvents", () => {
  it("removes duplicate external_uid, keeps last", () => {
    const events: NormalizedEvent[] = [
      makeEvent({ external_uid: "aaa", title: "First" }),
      makeEvent({ external_uid: "aaa", title: "Second" }),
      makeEvent({ external_uid: "bbb", title: "Third" }),
    ];
    const result = dedupeEvents(events);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, "Second");
    assert.equal(result[1].title, "Third");
  });
});

describe("syncScheduleEvents", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const orgId = "org-1";
  const sourceId = "source-1";
  const window = buildWindow("2025-03-01T00:00:00Z", "2025-03-31T23:59:59Z");

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("imports new events", async () => {
    const events: NormalizedEvent[] = [
      makeEvent({ external_uid: "e1", title: "Game 1" }),
      makeEvent({ external_uid: "e2", title: "Game 2" }),
    ];

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.imported, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.cancelled, 0);

    const rows = stub.getRows("schedule_events");
    assert.equal(rows.length, 2);
  });

  it("updates existing events on re-sync", async () => {
    stub.seed("schedule_events", [
      {
        org_id: orgId,
        source_id: sourceId,
        external_uid: "e1",
        title: "Old Title",
        start_at: "2025-03-15T10:00:00.000Z",
        end_at: "2025-03-15T12:00:00.000Z",
        status: "confirmed",
      },
    ]);

    const events: NormalizedEvent[] = [
      makeEvent({ external_uid: "e1", title: "New Title" }),
    ];

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.imported, 0);
    assert.equal(result.updated, 1);

    const rows = stub.getRows("schedule_events");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "New Title");
  });

  it("cancels events missing from new sync batch", async () => {
    stub.seed("schedule_events", [
      {
        org_id: orgId,
        source_id: sourceId,
        external_uid: "e1",
        title: "Kept",
        start_at: "2025-03-15T10:00:00.000Z",
        end_at: "2025-03-15T12:00:00.000Z",
        status: "confirmed",
      },
      {
        org_id: orgId,
        source_id: sourceId,
        external_uid: "e2",
        title: "Cancelled",
        start_at: "2025-03-16T10:00:00.000Z",
        end_at: "2025-03-16T12:00:00.000Z",
        status: "confirmed",
      },
    ]);

    // Only send e1 in this batch — e2 should be cancelled
    const events: NormalizedEvent[] = [
      makeEvent({ external_uid: "e1", title: "Kept" }),
    ];

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.imported, 0);
    assert.equal(result.updated, 1);
    assert.equal(result.cancelled, 1);

    const rows = stub.getRows("schedule_events");
    const cancelledRow = rows.find((r) => r.external_uid === "e2");
    assert.equal(cancelledRow?.status, "cancelled");
  });

  it("does not re-cancel already-cancelled events", async () => {
    stub.seed("schedule_events", [
      {
        org_id: orgId,
        source_id: sourceId,
        external_uid: "e1",
        title: "Already Cancelled",
        start_at: "2025-03-15T10:00:00.000Z",
        end_at: "2025-03-15T12:00:00.000Z",
        status: "cancelled",
      },
    ]);

    const events: NormalizedEvent[] = [];

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.cancelled, 0, "already-cancelled events should not count");
  });

  it("filters events outside the sync window", async () => {
    const events: NormalizedEvent[] = [
      makeEvent({ external_uid: "in-window", start_at: "2025-03-15T10:00:00.000Z" }),
      makeEvent({ external_uid: "before-window", start_at: "2025-02-15T10:00:00.000Z" }),
      makeEvent({ external_uid: "after-window", start_at: "2025-04-15T10:00:00.000Z" }),
    ];

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.imported, 1);
    const rows = stub.getRows("schedule_events");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].external_uid, "in-window");
  });

  it("full pipeline: mix of new, existing, out-of-window, and missing events", async () => {
    // Seed 3 existing events
    stub.seed("schedule_events", [
      {
        org_id: orgId,
        source_id: sourceId,
        external_uid: "existing-1",
        title: "Existing 1",
        start_at: "2025-03-10T10:00:00.000Z",
        end_at: "2025-03-10T12:00:00.000Z",
        status: "confirmed",
      },
      {
        org_id: orgId,
        source_id: sourceId,
        external_uid: "existing-2",
        title: "Existing 2",
        start_at: "2025-03-11T10:00:00.000Z",
        end_at: "2025-03-11T12:00:00.000Z",
        status: "confirmed",
      },
      {
        org_id: orgId,
        source_id: sourceId,
        external_uid: "will-cancel",
        title: "Will Cancel",
        start_at: "2025-03-12T10:00:00.000Z",
        end_at: "2025-03-12T12:00:00.000Z",
        status: "confirmed",
      },
    ]);

    const events: NormalizedEvent[] = [
      // Update existing
      makeEvent({ external_uid: "existing-1", title: "Updated 1", start_at: "2025-03-10T10:00:00.000Z" }),
      makeEvent({ external_uid: "existing-2", title: "Updated 2", start_at: "2025-03-11T10:00:00.000Z" }),
      // New event
      makeEvent({ external_uid: "new-1", title: "New Event", start_at: "2025-03-20T10:00:00.000Z" }),
      // Out of window — should be dropped
      makeEvent({ external_uid: "out-of-window", title: "Ignored", start_at: "2025-05-01T10:00:00.000Z" }),
    ];

    const result = await syncScheduleEvents(stub as never, {
      orgId,
      sourceId,
      events,
      window,
    });

    assert.equal(result.imported, 1, "1 new event");
    assert.equal(result.updated, 2, "2 existing events updated");
    assert.equal(result.cancelled, 1, "1 existing event missing from batch");

    const rows = stub.getRows("schedule_events");
    const cancelledRow = rows.find((r) => r.external_uid === "will-cancel");
    assert.equal(cancelledRow?.status, "cancelled");

    const newRow = rows.find((r) => r.external_uid === "new-1");
    assert.ok(newRow, "new event should exist");
    assert.equal(newRow?.title, "New Event");
  });
});
