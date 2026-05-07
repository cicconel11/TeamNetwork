import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAvailabilityRenderState,
  buildAvailabilityWeek,
  getCurrentTimeMarker,
} from "@/components/schedules/availability-week";
import { computeEventBlocks } from "@/components/schedules/availability-blocks";
import { formatDateKey } from "@/components/schedules/availability-stats";

describe("availability week context", () => {
  it("uses org-local week boundaries when the org is already in the next calendar day", () => {
    const context = buildAvailabilityWeek(
      new Date("2026-01-11T07:30:00.000Z"),
      0,
      "America/New_York",
    );

    assert.deepStrictEqual(
      context.weekDays.map((day) => formatDateKey(day)),
      [
        "2026-01-11",
        "2026-01-12",
        "2026-01-13",
        "2026-01-14",
        "2026-01-15",
        "2026-01-16",
        "2026-01-17",
      ],
    );
    assert.equal(formatDateKey(context.weekStart), "2026-01-11");
    assert.equal(context.todayKey, "2026-01-11");
    assert.equal(context.weekLabel, "Jan 11 - 17, 2026");
    assert.equal(context.rangeStart.toISOString(), "2026-01-11T05:00:00.000Z");
    assert.equal(context.rangeEnd.toISOString(), "2026-01-18T04:59:59.999Z");
  });

  it("keeps org-local Sunday events in the same org-local week", () => {
    const context = buildAvailabilityWeek(
      new Date("2026-01-11T07:30:00.000Z"),
      0,
      "America/New_York",
    );

    const result = computeEventBlocks(
      [],
      [
        {
          id: "org-sunday",
          user_id: "u1",
          title: "Sunday practice",
          start_at: "2026-01-11T14:00:00.000Z",
          end_at: "2026-01-11T16:00:00.000Z",
          all_day: false,
          users: null,
          origin: "schedule" as const,
        },
      ],
      context.weekDays,
      "America/New_York",
    );

    assert.ok(result.has("2026-01-11"));
    assert.equal(result.get("2026-01-11")?.[0].title, "Sunday practice");
  });

  it("tracks the current time using the org timezone", () => {
    const marker = getCurrentTimeMarker(
      new Date("2026-01-11T07:30:00.000Z"),
      "America/New_York",
    );

    assert.deepStrictEqual(marker, { dateKey: "2026-01-11", minute: 150 });
  });

  it("derives week context from the real clock instead of round-tripping through a date key", () => {
    const renderState = buildAvailabilityRenderState(
      new Date("2026-01-11T07:30:00.000Z"),
      0,
      "America/New_York",
    );

    assert.equal(renderState.todayKey, "2026-01-11");
    assert.equal(formatDateKey(renderState.weekStart), "2026-01-11");
    assert.deepStrictEqual(
      renderState.weekDays.map((day) => formatDateKey(day)),
      [
        "2026-01-11",
        "2026-01-12",
        "2026-01-13",
        "2026-01-14",
        "2026-01-15",
        "2026-01-16",
        "2026-01-17",
      ],
    );
    assert.equal(renderState.rangeStart.toISOString(), "2026-01-11T05:00:00.000Z");
    assert.equal(renderState.rangeEnd.toISOString(), "2026-01-18T04:59:59.999Z");
  });

  it("recomputes the org-local today marker after midnight", () => {
    const beforeMidnight = buildAvailabilityRenderState(
      new Date("2026-01-12T04:59:00.000Z"),
      0,
      "America/New_York",
    );
    const afterMidnight = buildAvailabilityRenderState(
      new Date("2026-01-12T05:01:00.000Z"),
      0,
      "America/New_York",
    );

    assert.equal(beforeMidnight.todayKey, "2026-01-11");
    assert.equal(beforeMidnight.currentMinute, 1439);
    assert.equal(afterMidnight.todayKey, "2026-01-12");
    assert.equal(afterMidnight.currentMinute, 1);
  });

  it("rolls the rendered week forward when midnight enters a new org-local week", () => {
    const beforeWeekRollover = buildAvailabilityRenderState(
      new Date("2026-01-18T04:59:00.000Z"),
      0,
      "America/New_York",
    );
    const afterWeekRollover = buildAvailabilityRenderState(
      new Date("2026-01-18T05:01:00.000Z"),
      0,
      "America/New_York",
    );

    assert.equal(formatDateKey(beforeWeekRollover.weekStart), "2026-01-11");
    assert.equal(beforeWeekRollover.todayKey, "2026-01-17");
    assert.equal(formatDateKey(afterWeekRollover.weekStart), "2026-01-18");
    assert.equal(afterWeekRollover.todayKey, "2026-01-18");
  });
});
