import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { expandIcsEvents, syncCalendarFeed } from "../src/lib/calendar/icsSync";

const WINDOW_START = new Date("2025-01-01T00:00:00Z");
const WINDOW_END = new Date("2025-01-31T23:59:59Z");

const window = { start: WINDOW_START, end: WINDOW_END };

function fixturePath(name: string) {
  return new URL(`./fixtures/ics/${name}`, import.meta.url);
}

test("parses a single event correctly", async () => {
  const icsText = await readFile(fixturePath("simple-single-event.ics"), "utf-8");
  const events = expandIcsEvents(icsText, window);

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Study Hall");
  assert.equal(events[0].location, "Room 101");
  assert.ok(events[0].instanceKey.startsWith("test-single-1@example.com|"));
});

test("expands RRULE into multiple instances", async () => {
  const icsText = await readFile(fixturePath("recurring-weekly.ics"), "utf-8");
  const events = expandIcsEvents(icsText, window);

  assert.equal(events.length, 3);
});

test("dedupes via instance_key", () => {
  const duplicateIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TeamMeet//Calendar Sync Test//EN",
    "BEGIN:VEVENT",
    "UID:dup-1@example.com",
    "DTSTAMP:20250101T120000Z",
    "DTSTART:20250110T140000Z",
    "DTEND:20250110T150000Z",
    "SUMMARY:Duplicate",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:dup-1@example.com",
    "DTSTAMP:20250101T120000Z",
    "DTSTART:20250110T140000Z",
    "DTEND:20250110T150000Z",
    "SUMMARY:Duplicate",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");

  const events = expandIcsEvents(duplicateIcs, window);
  assert.equal(events.length, 1);
});

test("updates last_error/status on failures", async () => {
  const updates: { table: string; values: Record<string, unknown> }[] = [];

  const mockSupabase = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          updates.push({ table, values });
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof syncCalendarFeed>[0];

  const feed = {
    id: "feed-1",
    user_id: "user-1",
    feed_url: "https://example.com/calendar.ics",
    provider: "ics",
    status: "active",
    last_synced_at: null,
    last_error: null,
    created_at: null,
    updated_at: null,
  };

  const result = await syncCalendarFeed(mockSupabase, feed, {
    window,
    fetcher: async () => {
      throw new Error("boom");
    },
    now: () => new Date("2025-01-01T00:00:00Z"),
  });

  assert.equal(result.status, "error");
  assert.ok(
    updates.some(
      (entry) =>
        entry.table === "calendar_feeds" && entry.values.status === "error" && entry.values.last_error === "boom"
    )
  );
});
