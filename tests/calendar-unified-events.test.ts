import test from "node:test";
import assert from "node:assert";
import { expandAcademicSchedule } from "../src/lib/calendar/unified-events";

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
