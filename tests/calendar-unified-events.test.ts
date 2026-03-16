import test from "node:test";
import assert from "node:assert";
import { expandAcademicSchedule } from "../src/lib/calendar/unified-events";

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
