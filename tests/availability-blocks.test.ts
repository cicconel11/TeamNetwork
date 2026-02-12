import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeEventBlocks,
  resolveOverlaps,
  type EventBlock,
} from "@/components/schedules/availability-blocks";

// Build a week starting from Sunday Jan 4 2026
function buildWeekDays(): Date[] {
  const start = new Date(2026, 0, 4); // Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function dateKey(day: Date): string {
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("computeEventBlocks", () => {
  const weekDays = buildWeekDays();

  it("creates blocks from a weekly academic schedule", () => {
    const schedules = [
      {
        id: "s1",
        user_id: "u1",
        title: "Math 101",
        start_date: "2026-01-01",
        end_date: "2026-06-01",
        start_time: "09:00",
        end_time: "10:30",
        occurrence_type: "weekly",
        day_of_week: [1, 3, 5], // Mon, Wed, Fri
        day_of_month: null,
        users: { name: "Alice", email: null },
      },
    ];

    const result = computeEventBlocks(schedules, [], weekDays);

    // Mon=Jan 5, Wed=Jan 7, Fri=Jan 9
    assert.ok(result.has("2026-01-05")); // Monday
    assert.ok(result.has("2026-01-07")); // Wednesday
    assert.ok(result.has("2026-01-09")); // Friday
    assert.ok(!result.has("2026-01-04")); // Sunday — no class
    assert.ok(!result.has("2026-01-06")); // Tuesday — no class

    const monBlocks = result.get("2026-01-05")!;
    assert.equal(monBlocks.length, 1);
    assert.equal(monBlocks[0].title, "Math 101");
    assert.equal(monBlocks[0].startMinute, 540); // 9:00 AM
    assert.equal(monBlocks[0].endMinute, 630); // 10:30 AM
    assert.equal(monBlocks[0].origin, "academic");
    assert.equal(monBlocks[0].memberName, "Alice");
  });

  it("creates blocks from calendar events", () => {
    const calendarEvents = [
      {
        id: "cal1",
        user_id: "u1",
        title: "Team standup",
        start_at: "2026-01-05T14:00:00",
        end_at: "2026-01-05T14:30:00",
        all_day: false,
        users: { name: "Alice", email: null },
        origin: "calendar" as const,
      },
    ];

    const result = computeEventBlocks([], calendarEvents, weekDays);
    assert.ok(result.has("2026-01-05"));

    const blocks = result.get("2026-01-05")!;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].title, "Team standup");
    assert.equal(blocks[0].startMinute, 840); // 14:00
    assert.equal(blocks[0].endMinute, 870); // 14:30
    assert.equal(blocks[0].origin, "calendar");
  });

  it("clamps events to grid bounds (6am-10pm)", () => {
    const calendarEvents = [
      {
        id: "early",
        user_id: "u1",
        title: "Early morning",
        start_at: "2026-01-05T04:00:00",
        end_at: "2026-01-05T08:00:00",
        all_day: false,
        users: null,
      },
      {
        id: "late",
        user_id: "u1",
        title: "Late night",
        start_at: "2026-01-05T20:00:00",
        end_at: "2026-01-05T23:00:00",
        all_day: false,
        users: null,
      },
    ];

    const result = computeEventBlocks([], calendarEvents, weekDays);
    const blocks = result.get("2026-01-05")!;
    assert.equal(blocks.length, 2);

    // Early event clamped: starts at 6am (360), ends at 8am (480)
    const early = blocks.find((b) => b.title === "Early morning")!;
    assert.equal(early.startMinute, 360);
    assert.equal(early.endMinute, 480);

    // Late event clamped: starts at 8pm (1200), ends at 10pm (1320)
    const late = blocks.find((b) => b.title === "Late night")!;
    assert.equal(late.startMinute, 1200);
    assert.equal(late.endMinute, 1320);
  });

  it("skips events entirely outside grid bounds", () => {
    const calendarEvents = [
      {
        id: "overnight",
        user_id: "u1",
        title: "Sleep",
        start_at: "2026-01-05T23:00:00",
        end_at: "2026-01-06T05:00:00",
        all_day: false,
        users: null,
      },
    ];

    const result = computeEventBlocks([], calendarEvents, weekDays);
    // Jan 5: 23:00-midnight → clamped to 22:00-22:00 → skipped (start >= end)
    // Jan 6: midnight-5:00 → clamped to 6:00-5:00 → skipped (start >= end)
    const jan5 = result.get("2026-01-05");
    const jan6 = result.get("2026-01-06");
    assert.ok(!jan5 || jan5.length === 0);
    assert.ok(!jan6 || jan6.length === 0);
  });

  it("handles all-day events", () => {
    const calendarEvents = [
      {
        id: "allday1",
        user_id: "u1",
        title: "Holiday",
        start_at: "2026-01-05T00:00:00",
        end_at: "2026-01-06T00:00:00",
        all_day: true,
        users: null,
      },
    ];

    const result = computeEventBlocks([], calendarEvents, weekDays);
    const blocks = result.get("2026-01-05")!;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].startMinute, 360); // 6am
    assert.equal(blocks[0].endMinute, 1320); // 10pm
    assert.equal(blocks[0].title, "Holiday");
  });

  it("handles org schedule events", () => {
    const calendarEvents = [
      {
        id: "org1",
        user_id: "u1",
        title: "Team practice",
        start_at: "2026-01-06T15:00:00",
        end_at: "2026-01-06T17:00:00",
        all_day: false,
        users: null,
        origin: "schedule" as const,
      },
    ];

    const result = computeEventBlocks([], calendarEvents, weekDays);
    const blocks = result.get("2026-01-06")!;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].isOrg, true);
    assert.equal(blocks[0].origin, "schedule");
    assert.equal(blocks[0].memberName, "Org schedule");
  });

  it("handles single occurrence schedule", () => {
    const schedules = [
      {
        id: "s2",
        user_id: "u1",
        title: "One-off meeting",
        start_date: "2026-01-07",
        end_date: null,
        start_time: "11:00",
        end_time: "12:00",
        occurrence_type: "single",
        day_of_week: null,
        day_of_month: null,
        users: null,
      },
    ];

    const result = computeEventBlocks(schedules, [], weekDays);
    assert.ok(result.has("2026-01-07"));
    assert.ok(!result.has("2026-01-08"));

    const blocks = result.get("2026-01-07")!;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].title, "One-off meeting");
    assert.equal(blocks[0].startMinute, 660);
    assert.equal(blocks[0].endMinute, 720);
  });
});

describe("resolveOverlaps", () => {
  it("returns empty array for no blocks", () => {
    const result = resolveOverlaps([]);
    assert.equal(result.length, 0);
  });

  it("assigns single column for non-overlapping events", () => {
    const blocks: EventBlock[] = [
      { id: "a", startMinute: 540, endMinute: 600, title: "A", memberName: "Alice", userId: "u1", isOrg: false, origin: "academic" },
      { id: "b", startMinute: 600, endMinute: 660, title: "B", memberName: "Alice", userId: "u1", isOrg: false, origin: "academic" },
      { id: "c", startMinute: 720, endMinute: 780, title: "C", memberName: "Alice", userId: "u1", isOrg: false, origin: "calendar" },
    ];

    const result = resolveOverlaps(blocks);
    assert.equal(result.length, 3);
    // All should be in column 0, totalColumns 1
    result.forEach((b) => {
      assert.equal(b.column, 0);
      assert.equal(b.totalColumns, 1);
    });
  });

  it("assigns multiple columns for overlapping events", () => {
    const blocks: EventBlock[] = [
      { id: "a", startMinute: 540, endMinute: 660, title: "A", memberName: "Alice", userId: "u1", isOrg: false, origin: "academic" },
      { id: "b", startMinute: 570, endMinute: 630, title: "B", memberName: "Bob", userId: "u2", isOrg: false, origin: "calendar" },
    ];

    const result = resolveOverlaps(blocks);
    assert.equal(result.length, 2);

    const a = result.find((b) => b.id === "a")!;
    const b = result.find((b) => b.id === "b")!;

    // They should be in different columns
    assert.notEqual(a.column, b.column);
    assert.equal(a.totalColumns, 2);
    assert.equal(b.totalColumns, 2);
  });

  it("handles three overlapping events", () => {
    const blocks: EventBlock[] = [
      { id: "a", startMinute: 540, endMinute: 660, title: "A", memberName: "A", userId: "u1", isOrg: false, origin: "academic" },
      { id: "b", startMinute: 560, endMinute: 620, title: "B", memberName: "B", userId: "u2", isOrg: false, origin: "academic" },
      { id: "c", startMinute: 580, endMinute: 640, title: "C", memberName: "C", userId: "u3", isOrg: false, origin: "academic" },
    ];

    const result = resolveOverlaps(blocks);
    assert.equal(result.length, 3);

    const columns = new Set(result.map((b) => b.column));
    assert.equal(columns.size, 3);
    result.forEach((b) => {
      assert.equal(b.totalColumns, 3);
    });
  });

  it("keeps separate overlap groups independent", () => {
    const blocks: EventBlock[] = [
      // Group 1: two overlapping
      { id: "a", startMinute: 540, endMinute: 600, title: "A", memberName: "A", userId: "u1", isOrg: false, origin: "academic" },
      { id: "b", startMinute: 570, endMinute: 630, title: "B", memberName: "B", userId: "u2", isOrg: false, origin: "academic" },
      // Group 2: standalone
      { id: "c", startMinute: 720, endMinute: 780, title: "C", memberName: "C", userId: "u3", isOrg: false, origin: "academic" },
    ];

    const result = resolveOverlaps(blocks);
    assert.equal(result.length, 3);

    const a = result.find((b) => b.id === "a")!;
    const b = result.find((b) => b.id === "b")!;
    const c = result.find((b) => b.id === "c")!;

    // Group 1: 2 columns
    assert.equal(a.totalColumns, 2);
    assert.equal(b.totalColumns, 2);
    assert.notEqual(a.column, b.column);

    // Group 2: 1 column
    assert.equal(c.totalColumns, 1);
    assert.equal(c.column, 0);
  });

  it("reuses columns when events in the same group don't overlap each other", () => {
    const blocks: EventBlock[] = [
      { id: "a", startMinute: 540, endMinute: 600, title: "A", memberName: "A", userId: "u1", isOrg: false, origin: "academic" },
      { id: "b", startMinute: 540, endMinute: 660, title: "B", memberName: "B", userId: "u2", isOrg: false, origin: "academic" },
      // "c" starts after "a" ends but overlaps with "b", so it can reuse "a"'s column
      { id: "c", startMinute: 600, endMinute: 650, title: "C", memberName: "C", userId: "u3", isOrg: false, origin: "academic" },
    ];

    const result = resolveOverlaps(blocks);
    assert.equal(result.length, 3);

    const a = result.find((b) => b.id === "a")!;
    const c = result.find((b) => b.id === "c")!;
    const b = result.find((b) => b.id === "b")!;

    // a and c can share a column (a ends at 600, c starts at 600)
    assert.equal(a.column, c.column);
    assert.notEqual(a.column, b.column);
    // All in same group, 2 columns
    assert.equal(a.totalColumns, 2);
    assert.equal(b.totalColumns, 2);
    assert.equal(c.totalColumns, 2);
  });
});
