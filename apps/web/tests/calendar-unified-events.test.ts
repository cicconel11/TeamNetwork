import test from "node:test";
import assert from "node:assert";
import { eventOverlapsRange } from "../src/lib/calendar/event-segments";
import {
  buildUnifiedCalendarDateRange,
  expandAcademicSchedule,
  getUnifiedEventFloatingDateKey,
  normalizeUnifiedTeamEvent,
  sortUnifiedEvents,
} from "../src/lib/calendar/unified-events";

const originalTimeZone = process.env.TZ;
process.env.TZ = "UTC";

test.after(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
    return;
  }

  process.env.TZ = originalTimeZone;
});

test("expandAcademicSchedule: weekly schedule expands within range", () => {
  const schedule = {
    id: "sched-1",
    title: "Math 101",
    start_date: "2026-03-01",
    end_date: "2026-03-31",
    start_time: "09:00:00",
    end_time: "10:00:00",
    occurrence_type: "weekly",
    day_of_week: [1, 3], // Monday, Wednesday
    day_of_month: null,
  };

  const rangeStart = new Date(2026, 2, 1); // March 1
  const rangeEnd = new Date(2026, 2, 15);  // March 15

  const events = expandAcademicSchedule(schedule, rangeStart, rangeEnd);

  assert.ok(events.length > 0, "Should produce events");
  assert.ok(events.every((e) => e.sourceType === "class"));
  assert.ok(events.every((e) => e.title === "Math 101"));
});

test("buildUnifiedCalendarDateRange: keeps server and client list windows aligned", () => {
  const range = buildUnifiedCalendarDateRange(new Date("2026-03-30T15:45:00.000Z"));

  assert.equal(range.start.toISOString(), "2026-03-29T00:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-27T23:59:59.999Z");
});

test("normalizeUnifiedTeamEvent: preserves plain-date team events as visible all-day rows", () => {
  const normalized = normalizeUnifiedTeamEvent(
    {
      id: "event-1",
      title: "Founders Day",
      start_date: "2026-03-30",
      end_date: null,
      location: "Main Hall",
      event_type: null,
      is_philanthropy: false,
      recurrence_group_id: null,
    },
    "America/New_York",
  );

  assert.deepStrictEqual(
    normalized,
    {
      id: "event:event-1",
      title: "Founders Day",
      startAt: "2026-03-30",
      endAt: "2026-03-31",
      allDay: true,
      location: "Main Hall",
      sourceType: "event",
      sourceName: "Team Event",
      badges: [],
      eventId: "event-1",
    },
  );

  const range = buildUnifiedCalendarDateRange(new Date("2026-03-30T15:45:00.000Z"));
  assert.equal(eventOverlapsRange(normalized, range.start, range.end), true);
});

test("sortUnifiedEvents: keeps floating all-day team events ordered by org-local day", () => {
  const sorted = sortUnifiedEvents(
    [
      {
        id: "event:event-1",
        title: "Founders Day",
        startAt: "2026-03-30",
        endAt: "2026-03-31",
        allDay: true,
        location: null,
        sourceType: "event",
        sourceName: "Team Event",
        badges: [],
        eventId: "event-1",
      },
      {
        id: "feed:feed-1",
        title: "Late practice film",
        startAt: "2026-03-30T03:30:00.000Z",
        endAt: "2026-03-30T04:30:00.000Z",
        allDay: false,
        location: null,
        sourceType: "feed",
        sourceName: "Calendar Feed",
        badges: [],
      },
    ],
    "America/New_York",
  );

  assert.deepStrictEqual(
    sorted.map((event) => event.id),
    ["feed:feed-1", "event:event-1"],
  );
});

test("sortUnifiedEvents: keeps imported all-day feed events ordered by floating local day", () => {
  const sorted = sortUnifiedEvents(
    [
      {
        id: "feed:all-day-import",
        title: "Imported Holiday",
        startAt: "2026-03-30T00:00:00.000Z",
        endAt: "2026-03-31T00:00:00.000Z",
        allDay: true,
        location: null,
        sourceType: "feed",
        sourceName: "Google Calendar",
        badges: [],
        floatingDateKey: "2026-03-30",
      },
      {
        id: "feed:late-film",
        title: "Late practice film",
        startAt: "2026-03-30T03:30:00.000Z",
        endAt: "2026-03-30T04:30:00.000Z",
        allDay: false,
        location: null,
        sourceType: "feed",
        sourceName: "Calendar Feed",
        badges: [],
      },
    ],
    "America/New_York",
  );

  assert.deepStrictEqual(
    sorted.map((event) => event.id),
    ["feed:late-film", "feed:all-day-import"],
  );
});

test("sortUnifiedEvents: uses explicit floating-date metadata for host-offset ICS all-day rows", () => {
  const sorted = sortUnifiedEvents(
    [
      {
        id: "feed:all-day-ics",
        title: "New Year Holiday",
        startAt: "2023-12-31T15:00:00.000Z",
        endAt: "2024-01-01T15:00:00.000Z",
        allDay: true,
        location: null,
        sourceType: "feed",
        sourceName: "Calendar Feed",
        badges: [],
        floatingDateKey: "2024-01-01",
      },
      {
        id: "feed:late-film",
        title: "Late practice film",
        startAt: "2024-01-01T06:30:00.000Z",
        endAt: "2024-01-01T07:30:00.000Z",
        allDay: false,
        location: null,
        sourceType: "feed",
        sourceName: "Calendar Feed",
        badges: [],
      },
    ],
    "America/Los_Angeles",
  );

  assert.deepStrictEqual(
    sorted.map((event) => event.id),
    ["feed:late-film", "feed:all-day-ics"],
  );
});

test("getUnifiedEventFloatingDateKey: never reinterprets an all-day ISO prefix without metadata", () => {
  assert.equal(
    getUnifiedEventFloatingDateKey({
      id: "feed:all-day-ics",
      title: "New Year Holiday",
      startAt: "2023-12-31T15:00:00.000Z",
      endAt: "2024-01-01T15:00:00.000Z",
      allDay: true,
      location: null,
      sourceType: "feed",
      sourceName: "Calendar Feed",
      badges: [],
    }),
    null,
  );

  assert.equal(
    getUnifiedEventFloatingDateKey({
      id: "feed:all-day-ics",
      title: "New Year Holiday",
      startAt: "2023-12-31T15:00:00.000Z",
      endAt: "2024-01-01T15:00:00.000Z",
      allDay: true,
      location: null,
      sourceType: "feed",
      sourceName: "Calendar Feed",
      badges: [],
      floatingDateKey: "2024-01-01",
    }),
    "2024-01-01",
  );
});

test("expandAcademicSchedule: uses org timezone for generated timestamps", () => {
  const schedule = {
    id: "sched-ny",
    title: "Morning Class",
    start_date: "2026-03-09",
    end_date: null,
    start_time: "09:00:00",
    end_time: "10:00:00",
    occurrence_type: "single",
    day_of_week: null,
    day_of_month: null,
  };

  const events = expandAcademicSchedule(
    schedule,
    new Date("2026-03-09T00:00:00.000Z"),
    new Date("2026-03-09T23:59:59.999Z"),
    "America/New_York",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].startAt, "2026-03-09T13:00:00.000Z");
  assert.equal(events[0].endAt, "2026-03-09T14:00:00.000Z");
  assert.equal(events[0].academicScheduleId, "sched-ny");
});

test("expandAcademicSchedule: handles DST fallback with org timezone offsets", () => {
  const schedule = {
    id: "sched-fall",
    title: "Morning Class",
    start_date: "2026-11-02",
    end_date: null,
    start_time: "09:00:00",
    end_time: "10:00:00",
    occurrence_type: "single",
    day_of_week: null,
    day_of_month: null,
  };

  const events = expandAcademicSchedule(
    schedule,
    new Date("2026-11-02T00:00:00.000Z"),
    new Date("2026-11-02T23:59:59.999Z"),
    "America/New_York",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].startAt, "2026-11-02T14:00:00.000Z");
  assert.equal(events[0].endAt, "2026-11-02T15:00:00.000Z");
});

test("expandAcademicSchedule: skips only nonexistent spring-forward occurrences", () => {
  const schedule = {
    id: "sched-spring-gap",
    title: "Early Lab",
    start_date: "2026-03-07",
    end_date: "2026-03-09",
    start_time: "02:30:00",
    end_time: "03:30:00",
    occurrence_type: "daily",
    day_of_week: null,
    day_of_month: null,
  };

  const events = expandAcademicSchedule(
    schedule,
    new Date("2026-03-07T00:00:00.000Z"),
    new Date("2026-03-09T23:59:59.999Z"),
    "America/New_York",
  );

  assert.equal(events.length, 2);
  assert.deepStrictEqual(
    events.map((event) => event.id),
    [
      "class:sched-spring-gap:2026-03-07",
      "class:sched-spring-gap:2026-03-09",
    ],
  );
  assert.equal(events[0].startAt, "2026-03-07T07:30:00.000Z");
  assert.equal(events[1].startAt, "2026-03-09T06:30:00.000Z");
});

test("expandAcademicSchedule: single occurrence outside range returns empty", () => {
  const schedule = {
    id: "sched-2",
    title: "One-time Event",
    start_date: "2026-04-01",
    end_date: null,
    start_time: "14:00:00",
    end_time: "15:00:00",
    occurrence_type: "single",
    day_of_week: null,
    day_of_month: null,
  };

  const rangeStart = new Date(2026, 2, 1);
  const rangeEnd = new Date(2026, 2, 31);

  const events = expandAcademicSchedule(schedule, rangeStart, rangeEnd);
  assert.strictEqual(events.length, 0, "Single occurrence outside range should return empty");
});
