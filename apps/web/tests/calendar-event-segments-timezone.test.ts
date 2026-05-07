import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCalendarEventTime,
  splitEventIntoLocalDaySegments,
} from "@/lib/calendar/event-segments";

const originalTimeZone = process.env.TZ;
process.env.TZ = "UTC";

after(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
    return;
  }

  process.env.TZ = originalTimeZone;
});

describe("timezone-aware event segments", () => {
  it("splits timed events using the org timezone instead of the machine timezone", () => {
    const segments = splitEventIntoLocalDaySegments(
      {
        startAt: "2026-01-06T01:00:00.000Z",
        endAt: "2026-01-06T03:00:00.000Z",
        allDay: false,
      },
      "America/New_York",
    );

    assert.deepStrictEqual(
      segments.map((segment) => ({
        dateKey: segment.dateKey,
        startMinute: segment.startMinute,
        endMinute: segment.endMinute,
      })),
      [{ dateKey: "2026-01-05", startMinute: 1200, endMinute: 1320 }],
    );
  });

  it("formats cross-midnight org-time events with both local dates", () => {
    const formatted = formatCalendarEventTime(
      {
        startAt: "2026-01-06T03:30:00.000Z",
        endAt: "2026-01-06T05:30:00.000Z",
        allDay: false,
      },
      "en-US",
      "America/New_York",
    );

    assert.equal(formatted, "Jan 5, 10:30 PM – Jan 6, 12:30 AM");
  });

  it("formats multi-day event times without locale-dependent connector text", () => {
    const formatted = formatCalendarEventTime(
      {
        startAt: "2026-04-02T18:00:00.000Z",
        endAt: "2026-04-03T06:15:00.000Z",
        allDay: false,
      },
      "en-US",
      "America/New_York",
    );

    assert.equal(formatted, "Apr 2, 2:00 PM – Apr 3, 2:15 AM");
  });
});
