import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../utils/supabaseStub";
import {
  createRecurringEvents,
  updateFutureEvents,
  deleteEventsInSeries,
} from "@/lib/events/recurring-operations";
import type { RecurrenceRule } from "@/lib/events/recurrence";

const ORG_ID = "org-123";

function makeBaseEvent(overrides = {}) {
  return {
    organization_id: ORG_ID,
    title: "Weekly Practice",
    description: "Team practice",
    start_date: "2026-03-09T18:00:00.000Z",
    end_date: "2026-03-09T19:00:00.000Z",
    location: "Field A",
    event_type: "general",
    is_philanthropy: false,
    created_by_user_id: "user-1",
    ...overrides,
  };
}

const weeklyRule: RecurrenceRule = {
  occurrence_type: "weekly",
  day_of_week: [1], // Monday
  recurrence_end_date: "2026-04-06",
};

describe("createRecurringEvents", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("creates all instances with shared group ID", async () => {
    const result = await createRecurringEvents(stub as never, makeBaseEvent(), weeklyRule);

    assert.equal(result.error, null);
    assert.ok(result.groupId, "Should return a group ID");

    const rows = stub.getRows("events");
    assert.equal(rows.length, 5, "Should create 5 weekly instances (Mar 9 - Apr 6)");

    // All share the same group ID
    for (const row of rows) {
      assert.equal(row.recurrence_group_id, result.groupId);
    }
  });

  it("sets recurrence_index sequentially starting from 0", async () => {
    await createRecurringEvents(stub as never, makeBaseEvent(), weeklyRule);

    const rows = stub.getRows("events");
    const indexes = rows.map((r) => r.recurrence_index).sort();
    assert.deepEqual(indexes, [0, 1, 2, 3, 4]);
  });

  it("stores recurrence_rule only on parent (index=0)", async () => {
    await createRecurringEvents(stub as never, makeBaseEvent(), weeklyRule);

    const rows = stub.getRows("events");
    const parent = rows.find((r) => r.recurrence_index === 0);
    const children = rows.filter((r) => r.recurrence_index !== 0);

    assert.ok(parent?.recurrence_rule, "Parent should have recurrence_rule");
    for (const child of children) {
      assert.equal(child.recurrence_rule, null, "Children should not have recurrence_rule");
    }
  });

  it("preserves event details across all instances", async () => {
    await createRecurringEvents(stub as never, makeBaseEvent(), weeklyRule);

    const rows = stub.getRows("events");
    for (const row of rows) {
      assert.equal(row.title, "Weekly Practice");
      assert.equal(row.description, "Team practice");
      assert.equal(row.location, "Field A");
      assert.equal(row.organization_id, ORG_ID);
    }
  });

  it("preserves duration across all instances", async () => {
    await createRecurringEvents(stub as never, makeBaseEvent(), weeklyRule);

    const rows = stub.getRows("events");
    for (const row of rows) {
      assert.ok(row.start_date, "Should have start_date");
      assert.ok(row.end_date, "Should have end_date");
      const dur = new Date(row.end_date as string).getTime() - new Date(row.start_date as string).getTime();
      assert.equal(dur, 3600000, "Duration should be 1 hour");
    }
  });

  it("returns event IDs for all created instances", async () => {
    const result = await createRecurringEvents(stub as never, makeBaseEvent(), weeklyRule);

    assert.equal(result.eventIds.length, 5);
    // All IDs should be unique
    const uniqueIds = new Set(result.eventIds);
    assert.equal(uniqueIds.size, 5);
  });
});

describe("updateFutureEvents", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const groupId = "group-abc";

  beforeEach(() => {
    stub = createSupabaseStub();
    // Seed 4 events: 2 in past, 2 in future
    const pastDate1 = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    const pastDate2 = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
    const futureDate1 = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
    const futureDate2 = new Date(Date.now() + 7 * 24 * 3600000).toISOString();

    stub.seed("events", [
      { id: "e1", organization_id: ORG_ID, title: "Practice", start_date: pastDate1, recurrence_group_id: groupId, recurrence_index: 0, deleted_at: null },
      { id: "e2", organization_id: ORG_ID, title: "Practice", start_date: pastDate2, recurrence_group_id: groupId, recurrence_index: 1, deleted_at: null },
      { id: "e3", organization_id: ORG_ID, title: "Practice", start_date: futureDate1, recurrence_group_id: groupId, recurrence_index: 2, deleted_at: null },
      { id: "e4", organization_id: ORG_ID, title: "Practice", start_date: futureDate2, recurrence_group_id: groupId, recurrence_index: 3, deleted_at: null },
    ]);
  });

  it("updates only future events from the given event forward", async () => {
    const result = await updateFutureEvents(stub as never, "e3", ORG_ID, { title: "Updated Practice" });

    assert.equal(result.error, null);
    assert.equal(result.updatedIds.length, 2, "Should update e3 and e4");
    assert.ok(result.updatedIds.includes("e3"));
    assert.ok(result.updatedIds.includes("e4"));

    const rows = stub.getRows("events");
    const e1 = rows.find((r) => r.id === "e1");
    const e3 = rows.find((r) => r.id === "e3");
    const e4 = rows.find((r) => r.id === "e4");

    assert.equal(e1?.title, "Practice", "Past event should not be updated");
    assert.equal(e3?.title, "Updated Practice");
    assert.equal(e4?.title, "Updated Practice");
  });

  it("returns error for non-recurring event", async () => {
    stub.seed("events", [
      { id: "solo", organization_id: ORG_ID, title: "Solo", start_date: new Date().toISOString(), recurrence_group_id: null, recurrence_index: null, deleted_at: null },
    ]);

    const result = await updateFutureEvents(stub as never, "solo", ORG_ID, { title: "X" });
    assert.ok(result.error);
  });
});

describe("deleteEventsInSeries", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const groupId = "group-del";

  beforeEach(() => {
    stub = createSupabaseStub();
    stub.seed("events", [
      { id: "d1", organization_id: ORG_ID, title: "P", recurrence_group_id: groupId, recurrence_index: 0, deleted_at: null },
      { id: "d2", organization_id: ORG_ID, title: "P", recurrence_group_id: groupId, recurrence_index: 1, deleted_at: null },
      { id: "d3", organization_id: ORG_ID, title: "P", recurrence_group_id: groupId, recurrence_index: 2, deleted_at: null },
      { id: "d4", organization_id: ORG_ID, title: "P", recurrence_group_id: groupId, recurrence_index: 3, deleted_at: null },
    ]);
  });

  it("deletes only the specified event with this_only scope", async () => {
    const result = await deleteEventsInSeries(stub as never, "d2", ORG_ID, "this_only");

    assert.equal(result.error, null);
    assert.deepEqual(result.deletedIds, ["d2"]);

    const rows = stub.getRows("events");
    const d2 = rows.find((r) => r.id === "d2");
    assert.ok(d2?.deleted_at, "d2 should be soft-deleted");

    const others = rows.filter((r) => r.id !== "d2");
    for (const row of others) {
      assert.equal(row.deleted_at, null, `${row.id} should not be deleted`);
    }
  });

  it("deletes this and future events with this_and_future scope", async () => {
    const result = await deleteEventsInSeries(stub as never, "d2", ORG_ID, "this_and_future");

    assert.equal(result.error, null);
    assert.equal(result.deletedIds.length, 3, "d2, d3, d4 should be deleted");
    assert.ok(result.deletedIds.includes("d2"));
    assert.ok(result.deletedIds.includes("d3"));
    assert.ok(result.deletedIds.includes("d4"));

    const rows = stub.getRows("events");
    const d1 = rows.find((r) => r.id === "d1");
    assert.equal(d1?.deleted_at, null, "d1 should not be deleted");

    const deleted = rows.filter((r) => r.deleted_at);
    assert.equal(deleted.length, 3);
  });

  it("deletes all events with all_in_series scope", async () => {
    const result = await deleteEventsInSeries(stub as never, "d3", ORG_ID, "all_in_series");

    assert.equal(result.error, null);
    assert.equal(result.deletedIds.length, 4, "All 4 should be deleted");

    const rows = stub.getRows("events");
    for (const row of rows) {
      assert.ok(row.deleted_at, `${row.id} should be soft-deleted`);
    }
  });
});
