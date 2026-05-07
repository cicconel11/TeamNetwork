import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  eventOverlapsRange,
  formatCalendarEventTime,
  splitEventIntoLocalDaySegments,
} from "@/lib/calendar/event-segments";

const originalTimeZone = process.env.TZ;
process.env.TZ = "America/New_York";

after(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
    return;
  }

  process.env.TZ = originalTimeZone;
});

describe("splitEventIntoLocalDaySegments", () => {
  it("splits a timed multi-day event into local day segments", () => {
    const segments = splitEventIntoLocalDaySegments({
      startAt: "2026-06-08T08:00:00-04:00",
      endAt: "2026-06-11T17:00:00-04:00",
      allDay: false,
    });

    assert.deepStrictEqual(
      segments.map((segment) => ({
        dateKey: segment.dateKey,
        startMinute: segment.startMinute,
        endMinute: segment.endMinute,
        spansFullDay: segment.spansFullDay,
      })),
      [
        { dateKey: "2026-06-08", startMinute: 480, endMinute: 1440, spansFullDay: false },
        { dateKey: "2026-06-09", startMinute: 0, endMinute: 1440, spansFullDay: true },
        { dateKey: "2026-06-10", startMinute: 0, endMinute: 1440, spansFullDay: true },
        { dateKey: "2026-06-11", startMinute: 0, endMinute: 1020, spansFullDay: false },
      ],
    );
  });

  it("treats all-day events with midnight end as inclusive through the previous day", () => {
    const segments = splitEventIntoLocalDaySegments({
      startAt: "2026-06-08T00:00:00Z",
      endAt: "2026-06-11T00:00:00Z",
      allDay: true,
    });

    assert.deepStrictEqual(
      segments.map((segment) => segment.dateKey),
      ["2026-06-08", "2026-06-09", "2026-06-10"],
    );
  });
});

describe("formatCalendarEventTime", () => {
  it("formats same-day timed events as a simple time range", () => {
    const formatted = formatCalendarEventTime({
      startAt: "2026-06-08T08:00:00-04:00",
      endAt: "2026-06-08T17:00:00-04:00",
      allDay: false,
    });

    assert.equal(formatted, "8:00 AM – 5:00 PM");
  });

  it("formats multi-day timed events with both dates", () => {
    const formatted = formatCalendarEventTime({
      startAt: "2026-06-08T08:00:00-04:00",
      endAt: "2026-06-11T17:00:00-04:00",
      allDay: false,
    });

    assert.equal(formatted, "Jun 8, 8:00 AM – Jun 11, 5:00 PM");
  });

  it("formats all-day events as all day", () => {
    const formatted = formatCalendarEventTime({
      startAt: "2026-06-08T00:00:00Z",
      endAt: "2026-06-09T00:00:00Z",
      allDay: true,
    });

    assert.equal(formatted, "All day");
  });
});

describe("eventOverlapsRange", () => {
  it("keeps timed null-end events visible through their synthetic duration", () => {
    const overlaps = eventOverlapsRange(
      {
        startAt: "2026-06-08T23:30:00-04:00",
        endAt: null,
        allDay: false,
      },
      new Date("2026-06-09T04:00:00Z"),
      new Date("2026-06-10T03:59:59Z"),
    );

    assert.equal(overlaps, true);
  });

  it("does not overlap the day after an all-day exclusive-end event finishes", () => {
    const overlaps = eventOverlapsRange(
      {
        startAt: "2026-06-01T00:00:00Z",
        endAt: "2026-06-11T00:00:00Z",
        allDay: true,
      },
      new Date("2026-06-11T04:00:00Z"),
      new Date("2026-06-12T03:59:59Z"),
    );

    assert.equal(overlaps, false);
  });

  it("still overlaps the last visible day of an all-day exclusive-end event", () => {
    const overlaps = eventOverlapsRange(
      {
        startAt: "2026-06-01T00:00:00Z",
        endAt: "2026-06-11T00:00:00Z",
        allDay: true,
      },
      new Date("2026-06-10T04:00:00Z"),
      new Date("2026-06-11T03:59:59Z"),
    );

    assert.equal(overlaps, true);
  });
});
