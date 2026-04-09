import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCalendarMonthGrid,
  formatCalendarMonthName,
  getCalendarMonthCursor,
} from "../src/components/calendar/CalendarMonthView";
import { getCurrentAvailabilityHour } from "../src/components/schedules/TeamAvailabilityRows";

describe("calendar month timezone stability", () => {
  it("derives the rendered month from the org timezone instead of the machine timezone", () => {
    const losAngelesMonth = getCalendarMonthCursor(
      new Date("2026-04-01T05:30:00.000Z"),
      "America/Los_Angeles",
    );
    const newYorkMonth = getCalendarMonthCursor(
      new Date("2026-04-01T05:30:00.000Z"),
      "America/New_York",
    );

    assert.deepStrictEqual(losAngelesMonth, { year: 2026, month: 2 });
    assert.deepStrictEqual(newYorkMonth, { year: 2026, month: 3 });
    assert.equal(formatCalendarMonthName(newYorkMonth.year, newYorkMonth.month), "April 2026");
  });

  it("builds a stable plain-date grid for the rendered month", () => {
    const grid = buildCalendarMonthGrid(2026, 3);

    assert.equal(grid[0]?.[0]?.dateKey, "2026-03-29");
    assert.equal(grid[0]?.[3]?.dateKey, "2026-04-01");
    assert.equal(grid[5]?.[6]?.dateKey, "2026-05-09");
  });
});

describe("team availability current-hour marker", () => {
  it("uses the org timezone for the highlighted current hour", () => {
    const now = new Date("2026-04-01T01:00:00.000Z");

    assert.equal(getCurrentAvailabilityHour(now, "America/New_York"), 21);
    assert.equal(getCurrentAvailabilityHour(now, "America/Los_Angeles"), 18);
  });
});
