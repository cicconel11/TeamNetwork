import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Extract the formatEventTime logic to test it directly
// (mirrors the function in UpcomingEventsTab.tsx)
type CalendarEventSummary = {
  id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  location: string | null;
};

function formatEventTime(event: CalendarEventSummary) {
  const start = new Date(event.start_at);

  if (event.all_day) {
    return "All day";
  }

  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };

  const startTime = start.toLocaleTimeString("en-US", timeOpts);

  if (!event.end_at) {
    return startTime;
  }

  const end = new Date(event.end_at);

  // Same day
  if (start.toDateString() === end.toDateString()) {
    const endTime = end.toLocaleTimeString("en-US", timeOpts);
    return `${startTime} – ${endTime}`;
  }

  // Multi-day
  const dateTimeOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${start.toLocaleDateString("en-US", dateTimeOpts)} – ${end.toLocaleDateString("en-US", dateTimeOpts)}`;
}

function makeEvent(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    id: "test-1",
    title: "Test Event",
    start_at: "2026-02-12T16:30:00Z",
    end_at: "2026-02-12T16:50:00Z",
    all_day: false,
    location: null,
    ...overrides,
  };
}

describe("formatEventTime", () => {
  it("formats same-day event as time range", () => {
    const event = makeEvent({
      start_at: "2026-02-12T16:30:00Z",
      end_at: "2026-02-12T16:50:00Z",
    });
    const result = formatEventTime(event);
    // Should contain start and end times with en-dash separator, no date
    assert.ok(result.includes("–"), `Expected en-dash separator, got: ${result}`);
    assert.ok(!result.includes("Feb"), `Should not contain date for same-day event, got: ${result}`);
    assert.ok(!result.includes("2026"), `Should not contain year, got: ${result}`);
  });

  it("returns 'All day' for all-day events", () => {
    const event = makeEvent({ all_day: true });
    assert.equal(formatEventTime(event), "All day");
  });

  it("returns just start time when no end time", () => {
    const event = makeEvent({ end_at: null });
    const result = formatEventTime(event);
    assert.ok(!result.includes("–"), `Should not have separator without end time, got: ${result}`);
    // Should be a time-only string
    assert.ok(result.includes("AM") || result.includes("PM"), `Expected AM/PM in: ${result}`);
  });

  it("formats multi-day event with date and time", () => {
    const event = makeEvent({
      start_at: "2026-02-12T16:30:00Z",
      end_at: "2026-02-13T19:00:00Z",
    });
    const result = formatEventTime(event);
    assert.ok(result.includes("–"), `Expected en-dash separator, got: ${result}`);
    // Multi-day should include month abbreviations
    assert.ok(result.includes("Feb"), `Expected month in multi-day format, got: ${result}`);
  });

  it("handles midnight crossing correctly", () => {
    // Use dates far enough apart that they're different calendar days in any timezone
    const event = makeEvent({
      start_at: "2026-02-12T08:30:00Z",
      end_at: "2026-02-14T02:30:00Z",
    });
    const result = formatEventTime(event);
    // These are clearly different dates so should show multi-day format
    assert.ok(result.includes("–"), `Expected en-dash separator, got: ${result}`);
    assert.ok(result.includes("Feb"), `Expected month for cross-day event, got: ${result}`);
  });
});
