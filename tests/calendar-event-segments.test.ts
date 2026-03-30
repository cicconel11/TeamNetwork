import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCalendarEventTime,
  splitEventIntoLocalDaySegments,
} from "@/lib/calendar/event-segments";

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
