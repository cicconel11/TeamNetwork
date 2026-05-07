import test from "node:test";
import assert from "node:assert";
import { expandIcsEvents } from "@/lib/schedule-connectors/ics";

/**
 * Tests for ICS recurring event expansion edge cases.
 * Covers RRULE with exdates, timezone mismatches, overrides, all-day events, and windowed recurrence.
 */

const WINDOW = {
  from: new Date("2024-01-01T00:00:00Z"),
  to: new Date("2024-12-31T23:59:59Z"),
};

function buildIcs(vevents: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Test//EN",
    ...vevents.split("\n"),
    "END:VCALENDAR",
  ].join("\r\n");
}

// ── Basic RRULE ──

test("RRULE weekly expands correct number of occurrences within window", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:weekly-1
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Weekly Meeting
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.strictEqual(events.length, 4);
  assert.strictEqual(events[0].title, "Weekly Meeting");
});

test("RRULE monthly generates correct occurrences", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:monthly-1
DTSTART:20240115T090000Z
DTEND:20240115T100000Z
RRULE:FREQ=MONTHLY;COUNT=6
SUMMARY:Monthly Review
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.strictEqual(events.length, 6);
  // Verify months: Jan, Feb, Mar, Apr, May, Jun
  const months = events.map((e) => new Date(e.start_at).getUTCMonth());
  assert.deepStrictEqual(months, [0, 1, 2, 3, 4, 5]);
});

// ── RRULE with EXDATE ──

test("RRULE with exdate exclusion removes specific occurrences", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:exdate-1
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:20240108T100000Z
SUMMARY:Weekly with Skip
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  // 4 occurrences minus 1 exdate = 3
  assert.strictEqual(events.length, 3);
  const starts = events.map((e) => e.start_at);
  // Jan 8 should be excluded
  assert.ok(!starts.some((s) => s.includes("2024-01-08")), "Jan 8 should be excluded");
});

test("RRULE with multiple exdates excludes all specified dates", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:multi-exdate-1
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
RRULE:FREQ=WEEKLY;COUNT=5
EXDATE:20240108T100000Z
EXDATE:20240122T100000Z
SUMMARY:Multi Exdate
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  // 5 occurrences minus 2 exdates = 3
  assert.strictEqual(events.length, 3);
});

// ── Fix 5: Exdate with timezone offset mismatch ──

test("exdate with timezone offset mismatch is still correctly excluded (timestamp comparison)", () => {
  // The exdate key in node-ical may be stored with a different string representation
  // but the Date objects should compare equal by timestamp.
  // This test verifies the fix from Issue 5.
  const ics = buildIcs(`BEGIN:VEVENT
UID:tz-exdate-1
DTSTART;TZID=America/New_York:20240101T100000
DTEND;TZID=America/New_York:20240101T110000
RRULE:FREQ=WEEKLY;COUNT=3
EXDATE;TZID=America/New_York:20240108T100000
SUMMARY:TZ Exdate Test
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  // Should have 2 events (3 minus 1 exdate)
  assert.strictEqual(events.length, 2);
  // Verify that Jan 8 (ET) occurrence is not present
  const jan8 = events.find((e) => {
    const d = new Date(e.start_at);
    return d.getUTCMonth() === 0 && d.getUTCDate() === 8;
  });
  assert.strictEqual(jan8, undefined, "Jan 8 occurrence should be excluded despite timezone format difference");
});

// ── Recurrence Overrides ──

test("recurrence override replaces occurrence data", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:override-1
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Original Title
END:VEVENT
BEGIN:VEVENT
UID:override-1
RECURRENCE-ID:20240108T100000Z
DTSTART:20240108T140000Z
DTEND:20240108T150000Z
SUMMARY:Modified Title
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.strictEqual(events.length, 3);

  // Find the Jan 8 occurrence — it should have the override data
  const jan8Event = events.find((e) => {
    const d = new Date(e.start_at);
    return d.getUTCMonth() === 0 && d.getUTCDate() === 8;
  });
  if (jan8Event) {
    // If the override is applied, title should be "Modified Title"
    // and time should be 14:00
    assert.strictEqual(jan8Event.title, "Modified Title");
    assert.ok(jan8Event.start_at.includes("14:00:00"), "Override should change start time");
  }
});

// ── All-Day Events ──

test("all-day recurring events have correct duration", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:allday-1
DTSTART;VALUE=DATE:20240101
DTEND;VALUE=DATE:20240102
RRULE:FREQ=MONTHLY;COUNT=3
SUMMARY:Monthly Holiday
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.ok(events.length >= 1, "Should have at least 1 all-day event");

  for (const event of events) {
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    const durationMs = end.getTime() - start.getTime();
    // All-day events should be 24 hours
    assert.strictEqual(durationMs, 24 * 60 * 60 * 1000, `All-day event should be 24h, got ${durationMs}ms`);
  }
});

// ── Window Bounding ──

test("RRULE occurrences outside window are excluded", () => {
  const narrowWindow = {
    from: new Date("2024-02-01T00:00:00Z"),
    to: new Date("2024-02-29T23:59:59Z"),
  };

  const ics = buildIcs(`BEGIN:VEVENT
UID:window-1
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
RRULE:FREQ=WEEKLY;COUNT=52
SUMMARY:Bounded Weekly
END:VEVENT`);

  const events = expandIcsEvents(ics, narrowWindow);
  // Should only include February occurrences
  for (const event of events) {
    const d = new Date(event.start_at);
    assert.ok(d >= narrowWindow.from, `Event ${event.start_at} should be >= window.from`);
    assert.ok(d <= narrowWindow.to, `Event ${event.start_at} should be <= window.to`);
  }
  // Feb has ~4 weeks, so expect around 4-5 events
  assert.ok(events.length >= 4 && events.length <= 5, `Expected 4-5 February events, got ${events.length}`);
});

// ── Non-recurring events ──

test("non-recurring event within window is included", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:single-1
DTSTART:20240315T100000Z
DTEND:20240315T110000Z
SUMMARY:One-off Event
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].title, "One-off Event");
});

test("non-recurring event outside window is excluded", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:outside-1
DTSTART:20230615T100000Z
DTEND:20230615T110000Z
SUMMARY:Past Event
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.strictEqual(events.length, 0);
});

// ── Cancelled recurring events ──

test("cancelled status is preserved on recurring instances", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:cancelled-recurring-1
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
RRULE:FREQ=WEEKLY;COUNT=2
STATUS:CANCELLED
SUMMARY:Cancelled Series
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  for (const event of events) {
    assert.strictEqual(event.status, "cancelled", "All instances of cancelled series should be cancelled");
  }
});

// ── Event with no UID ──

test("events without UID are skipped", () => {
  const ics = buildIcs(`BEGIN:VEVENT
DTSTART:20240315T100000Z
DTEND:20240315T110000Z
SUMMARY:No UID
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.strictEqual(events.length, 0);
});

// ── Event with no start date ──

test("non-recurring events without start date are skipped", () => {
  const ics = buildIcs(`BEGIN:VEVENT
UID:nostart-1
DTEND:20240315T110000Z
SUMMARY:No Start
END:VEVENT`);

  const events = expandIcsEvents(ics, WINDOW);
  assert.strictEqual(events.length, 0);
});
