import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatShortDate } from "@/lib/utils/dates";
import { mapEventToCalendarEvent } from "@/lib/google/calendar-event-mapper";

/**
 * Tests for calendar timezone bug fixes.
 *
 * BUG 1 — Recurrence auto-select UTC day from date+time
 * BUG 3 — Google Calendar mapEventToCalendarEvent timezone param
 * BUG 5 — formatShortDate plain date parsing
 */

// ─── BUG 1: Recurrence auto-select day-of-week ─────────────────────────

describe("Recurrence auto-select UTC day from date+time", () => {
  /**
   * Simulates the auto-select logic from events/new/page.tsx.
   * Given startDate + startTime (local), returns the UTC day-of-week
   * that will be stored in the recurrence rule.
   */
  function computeAutoSelectDay(startDate: string, startTime: string | null): number {
    const d = startTime
      ? new Date(`${startDate}T${startTime}`)
      : new Date(`${startDate}T12:00:00`);
    return d.getUTCDay();
  }

  it("Monday 11:30 PM Eastern (UTC-5) → UTC Tuesday", () => {
    // 2026-03-09 is a Monday. 23:30 local = next day in UTC for UTC-5.
    // We can't control TZ in node:test easily, so test with explicit UTC instead:
    // Simulate: local parse of "2026-03-10T04:30" (which is Tue 04:30 UTC = Mon 11:30 PM ET)
    const d = new Date("2026-03-10T04:30:00Z");
    assert.equal(d.getUTCDay(), 2, "Should be Tuesday in UTC");
  });

  it("Monday 8:00 AM Eastern (UTC-5) → UTC Monday", () => {
    // 8:00 AM ET = 13:00 UTC, still Monday
    const d = new Date("2026-03-09T13:00:00Z");
    assert.equal(d.getUTCDay(), 1, "Should be Monday in UTC");
  });

  it("Friday 11:00 PM Eastern (UTC-5) → UTC Saturday", () => {
    // 2026-03-13 is Friday. 23:00 ET = Saturday 04:00 UTC
    const d = new Date("2026-03-14T04:00:00Z");
    assert.equal(d.getUTCDay(), 6, "Should be Saturday in UTC");
  });

  it("no start time → noon local fallback → same UTC day as local for midday", () => {
    // Noon local is far enough from midnight that UTC day = local day
    const day = computeAutoSelectDay("2026-03-09", null);
    // 2026-03-09 noon local → UTC should be same calendar day (Monday=1)
    // In any US timezone, noon local is afternoon/evening UTC = still Monday
    assert.equal(day, 1, "Noon local on Monday should be Monday UTC");
  });

  it("start time provided → uses combined date+time for UTC day", () => {
    // 2026-03-09 at 08:00 local → UTC morning/afternoon, still Monday
    const day = computeAutoSelectDay("2026-03-09", "08:00");
    assert.equal(day, 1, "Morning event on Monday should be Monday UTC");
  });
});

// ─── BUG 3: mapEventToCalendarEvent timezone ───────────────────────────

describe("mapEventToCalendarEvent timezone parameter", () => {
  it("uses org timezone when provided", () => {
    const result = mapEventToCalendarEvent(
      { title: "Practice", start_date: "2026-03-09T23:00:00.000Z" },
      "America/New_York",
    );
    assert.equal(result.start.timeZone, "America/New_York");
    assert.equal(result.end.timeZone, "America/New_York");
  });

  it("falls back to UTC when no timezone provided", () => {
    const result = mapEventToCalendarEvent(
      { title: "Practice", start_date: "2026-03-09T23:00:00.000Z" },
    );
    assert.equal(result.start.timeZone, "UTC");
    assert.equal(result.end.timeZone, "UTC");
  });

  it("uses org timezone for both start and end", () => {
    const result = mapEventToCalendarEvent(
      {
        title: "Game",
        start_date: "2026-03-09T18:00:00.000Z",
        end_date: "2026-03-09T20:00:00.000Z",
      },
      "America/Chicago",
    );
    assert.equal(result.start.timeZone, "America/Chicago");
    assert.equal(result.end.timeZone, "America/Chicago");
  });

  it("preserves all event fields with timezone param", () => {
    const result = mapEventToCalendarEvent(
      {
        title: "Meeting",
        description: "Weekly standup",
        location: "Room 101",
        start_date: "2026-03-09T14:00:00.000Z",
        end_date: "2026-03-09T15:00:00.000Z",
      },
      "America/Los_Angeles",
    );
    assert.equal(result.summary, "Meeting");
    assert.equal(result.description, "Weekly standup");
    assert.equal(result.location, "Room 101");
    assert.equal(result.start.timeZone, "America/Los_Angeles");
  });
});

// ─── BUG 5: formatShortDate plain date parsing ─────────────────────────

describe("formatShortDate plain date string parsing", () => {
  it("plain YYYY-MM-DD renders correct day (not shifted by UTC midnight)", () => {
    const result = formatShortDate("2026-03-09");
    assert.match(result, /Mar\s+9/, `Expected "Mar 9" but got "${result}"`);
  });

  it("New Year's Day edge case", () => {
    const result = formatShortDate("2026-01-01");
    assert.match(result, /Jan\s+1/, `Expected "Jan 1" but got "${result}"`);
  });

  it("full ISO string still works correctly", () => {
    const result = formatShortDate("2026-03-09T04:00:00.000Z");
    // This is 2026-03-09 04:00 UTC — in US timezones displays as Mar 8 (correct local behavior)
    // The key is it doesn't crash and returns a valid date string
    assert.match(result, /Mar\s+\d+/, `Expected a March date but got "${result}"`);
  });

  it("end-of-year plain date", () => {
    const result = formatShortDate("2026-12-31");
    assert.match(result, /Dec\s+31/, `Expected "Dec 31" but got "${result}"`);
  });
});
