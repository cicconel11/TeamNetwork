import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  localToUtcIso,
  utcToLocalParts,
  resolveOrgTimezone,
  getLocalWeekday,
  getLocalDayOfMonth,
} from "@/lib/utils/timezone";

describe("resolveOrgTimezone", () => {
  it("returns the timezone when valid", () => {
    assert.equal(resolveOrgTimezone("America/New_York"), "America/New_York");
    assert.equal(resolveOrgTimezone("Europe/London"), "Europe/London");
    assert.equal(resolveOrgTimezone("Asia/Tokyo"), "Asia/Tokyo");
  });

  it("falls back to America/New_York for null/undefined", () => {
    assert.equal(resolveOrgTimezone(null), "America/New_York");
    assert.equal(resolveOrgTimezone(undefined), "America/New_York");
  });

  it("falls back to America/New_York for invalid timezone", () => {
    assert.equal(resolveOrgTimezone("Not/A/Timezone"), "America/New_York");
    assert.equal(resolveOrgTimezone(""), "America/New_York");
  });
});

describe("localToUtcIso", () => {
  it("converts EDT time to UTC (UTC-4)", () => {
    // June 9 is EDT (UTC-4)
    const result = localToUtcIso("2026-06-09", "16:00", "America/New_York");
    assert.equal(result, "2026-06-09T20:00:00.000Z");
  });

  it("converts EST time to UTC (UTC-5)", () => {
    // January is EST (UTC-5)
    const result = localToUtcIso("2026-01-15", "14:00", "America/New_York");
    assert.equal(result, "2026-01-15T19:00:00.000Z");
  });

  it("handles midnight crossover (11 PM ET = next day UTC in summer)", () => {
    // 11 PM EDT = 3 AM UTC next day
    const result = localToUtcIso("2026-06-09", "23:00", "America/New_York");
    assert.equal(result, "2026-06-10T03:00:00.000Z");
  });

  it("handles midnight crossover in winter (11 PM EST = 4 AM UTC next day)", () => {
    const result = localToUtcIso("2026-01-15", "23:00", "America/New_York");
    assert.equal(result, "2026-01-16T04:00:00.000Z");
  });

  it("handles Pacific time (UTC-7 PDT)", () => {
    const result = localToUtcIso("2026-06-09", "10:00", "America/Los_Angeles");
    assert.equal(result, "2026-06-09T17:00:00.000Z");
  });

  it("handles UTC timezone (no offset)", () => {
    const result = localToUtcIso("2026-06-09", "16:00", "UTC");
    assert.equal(result, "2026-06-09T16:00:00.000Z");
  });

  it("handles midnight local time", () => {
    const result = localToUtcIso("2026-06-09", "00:00", "America/New_York");
    assert.equal(result, "2026-06-09T04:00:00.000Z");
  });

  it("handles DST spring-forward boundary (March 2026)", () => {
    // DST starts March 8, 2026 in America/New_York
    // March 7 is still EST (UTC-5)
    const beforeDst = localToUtcIso("2026-03-07", "12:00", "America/New_York");
    assert.equal(beforeDst, "2026-03-07T17:00:00.000Z");

    // March 9 is EDT (UTC-4)
    const afterDst = localToUtcIso("2026-03-09", "12:00", "America/New_York");
    assert.equal(afterDst, "2026-03-09T16:00:00.000Z");
  });

  it("handles DST fall-back boundary (November 2026)", () => {
    // DST ends November 1, 2026 in America/New_York
    // October 31 is EDT (UTC-4)
    const beforeFallback = localToUtcIso("2026-10-31", "12:00", "America/New_York");
    assert.equal(beforeFallback, "2026-10-31T16:00:00.000Z");

    // November 2 is EST (UTC-5)
    const afterFallback = localToUtcIso("2026-11-02", "12:00", "America/New_York");
    assert.equal(afterFallback, "2026-11-02T17:00:00.000Z");
  });

  it("rejects nonexistent spring-forward local times", () => {
    assert.throws(
      () => localToUtcIso("2026-03-08", "02:30", "America/New_York"),
      /Nonexistent local time/
    );
  });

  it("keeps fall-back ambiguous times round-trip stable", () => {
    const utc = localToUtcIso("2026-11-01", "01:30", "America/New_York");
    const parts = utcToLocalParts(utc, "America/New_York");

    assert.equal(parts.time, "01:30");
    assert.equal(parts.date, "2026-11-01");
    assert.equal(localToUtcIso(parts.date, parts.time, "America/New_York"), utc);
  });
});

describe("utcToLocalParts", () => {
  it("decomposes UTC to EDT parts", () => {
    const result = utcToLocalParts("2026-06-09T20:00:00.000Z", "America/New_York");
    assert.equal(result.date, "2026-06-09");
    assert.equal(result.time, "16:00");
  });

  it("decomposes UTC to EST parts", () => {
    const result = utcToLocalParts("2026-01-15T19:00:00.000Z", "America/New_York");
    assert.equal(result.date, "2026-01-15");
    assert.equal(result.time, "14:00");
  });

  it("handles date crossover (early morning UTC = previous day ET)", () => {
    // 3 AM UTC = 11 PM EDT previous day
    const result = utcToLocalParts("2026-06-10T03:00:00.000Z", "America/New_York");
    assert.equal(result.date, "2026-06-09");
    assert.equal(result.time, "23:00");
  });

  it("returns empty strings for invalid ISO string", () => {
    const result = utcToLocalParts("not-a-date", "America/New_York");
    assert.equal(result.date, "");
    assert.equal(result.time, "");
  });
});

describe("round-trip: localToUtcIso → utcToLocalParts", () => {
  it("preserves date and time through round-trip (EDT)", () => {
    const originalDate = "2026-06-15";
    const originalTime = "09:30";
    const tz = "America/New_York";

    const utc = localToUtcIso(originalDate, originalTime, tz);
    const { date, time } = utcToLocalParts(utc, tz);

    assert.equal(date, originalDate);
    assert.equal(time, originalTime);
  });

  it("preserves date and time through round-trip (EST)", () => {
    const originalDate = "2026-12-25";
    const originalTime = "18:45";
    const tz = "America/New_York";

    const utc = localToUtcIso(originalDate, originalTime, tz);
    const { date, time } = utcToLocalParts(utc, tz);

    assert.equal(date, originalDate);
    assert.equal(time, originalTime);
  });

  it("preserves date and time through round-trip (Pacific)", () => {
    const originalDate = "2026-07-04";
    const originalTime = "21:00";
    const tz = "America/Los_Angeles";

    const utc = localToUtcIso(originalDate, originalTime, tz);
    const { date, time } = utcToLocalParts(utc, tz);

    assert.equal(date, originalDate);
    assert.equal(time, originalTime);
  });

  it("preserves midnight through round-trip", () => {
    const originalDate = "2026-06-09";
    const originalTime = "00:00";
    const tz = "America/New_York";

    const utc = localToUtcIso(originalDate, originalTime, tz);
    const { date, time } = utcToLocalParts(utc, tz);

    assert.equal(date, originalDate);
    assert.equal(time, originalTime);
  });
});

describe("getLocalWeekday", () => {
  it("returns correct weekday for timezone-adjusted date", () => {
    // 2026-06-09 is a Tuesday
    const utcIso = localToUtcIso("2026-06-09", "16:00", "America/New_York");
    assert.equal(getLocalWeekday(utcIso, "America/New_York"), 2); // Tuesday
  });

  it("handles date crossover correctly", () => {
    // 11 PM ET on June 9 (Tuesday) = 3 AM UTC June 10 (Wednesday)
    // But in ET it should still be Tuesday
    const utcIso = localToUtcIso("2026-06-09", "23:00", "America/New_York");
    assert.equal(getLocalWeekday(utcIso, "America/New_York"), 2); // Tuesday
  });
});

describe("getLocalDayOfMonth", () => {
  it("returns correct day of month in timezone", () => {
    const utcIso = localToUtcIso("2026-06-15", "10:00", "America/New_York");
    assert.equal(getLocalDayOfMonth(utcIso, "America/New_York"), 15);
  });

  it("handles date crossover correctly", () => {
    // 11 PM ET on the 9th = early UTC on the 10th
    const utcIso = localToUtcIso("2026-06-09", "23:00", "America/New_York");
    assert.equal(getLocalDayOfMonth(utcIso, "America/New_York"), 9);
  });
});
