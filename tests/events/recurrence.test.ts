import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expandRecurrence, type RecurrenceRule } from "@/lib/events/recurrence";

describe("expandRecurrence", () => {
  // ─── Weekly ─────────────────────────────────────────────────────────

  describe("weekly", () => {
    it("generates instances for a single day of the week", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "weekly",
        day_of_week: [1], // Monday
        recurrence_end_date: "2026-04-06", // ~4 weeks
      };
      // 2026-03-09 is a Monday (UTC)
      const instances = expandRecurrence("2026-03-09T18:00:00.000Z", "2026-03-09T19:00:00.000Z", rule);

      assert.ok(instances.length > 0, "Should produce instances");
      // Every Monday from Mar 9 to Apr 6: Mar 9, 16, 23, 30, Apr 6 = 5
      assert.equal(instances.length, 5);
      // All should be Mondays (UTC)
      for (const inst of instances) {
        assert.equal(new Date(inst.start_date).getUTCDay(), 1, "Should be Monday");
      }
      // Duration preserved (1 hour)
      for (const inst of instances) {
        assert.ok(inst.end_date, "Should have end_date");
        const dur = new Date(inst.end_date!).getTime() - new Date(inst.start_date).getTime();
        assert.equal(dur, 3600000, "Duration should be 1 hour");
      }
      // Indexes are sequential
      instances.forEach((inst, i) => assert.equal(inst.recurrence_index, i));
    });

    it("generates instances for multiple days of the week", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "weekly",
        day_of_week: [1, 3, 5], // Mon, Wed, Fri
        recurrence_end_date: "2026-03-20",
      };
      // 2026-03-09 is a Monday (UTC)
      const instances = expandRecurrence("2026-03-09T10:00:00.000Z", null, rule);

      // Mon 9, Wed 11, Fri 13, Mon 16, Wed 18, Fri 20 = 6
      assert.equal(instances.length, 6);
      const days = instances.map((inst) => new Date(inst.start_date).getUTCDay());
      assert.deepEqual(days, [1, 3, 5, 1, 3, 5]);
      // No end_date
      for (const inst of instances) {
        assert.equal(inst.end_date, null);
      }
    });

    it("caps at 52 instances for long ranges", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "weekly",
        day_of_week: [1],
        recurrence_end_date: "2028-12-31", // ~2.5 years
      };
      const instances = expandRecurrence("2026-03-09T10:00:00.000Z", null, rule);
      assert.equal(instances.length, 52);
    });

    it("uses start date's day if day_of_week not specified", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "weekly",
        recurrence_end_date: "2026-03-30",
      };
      // 2026-03-09 is Monday (day=1 UTC)
      const instances = expandRecurrence("2026-03-09T10:00:00.000Z", null, rule);
      for (const inst of instances) {
        assert.equal(new Date(inst.start_date).getUTCDay(), 1);
      }
    });
  });

  // ─── Daily ──────────────────────────────────────────────────────────

  describe("daily", () => {
    it("generates daily instances", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "daily",
        recurrence_end_date: "2026-03-14",
      };
      // Mar 9 to Mar 14 inclusive = 6 days
      const instances = expandRecurrence("2026-03-09T08:00:00.000Z", "2026-03-09T09:30:00.000Z", rule);
      assert.equal(instances.length, 6);

      // Duration preserved (1.5 hours)
      for (const inst of instances) {
        assert.ok(inst.end_date);
        const dur = new Date(inst.end_date!).getTime() - new Date(inst.start_date).getTime();
        assert.equal(dur, 5400000);
      }
    });

    it("caps at 180 instances", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "daily",
        recurrence_end_date: "2027-12-31",
      };
      const instances = expandRecurrence("2026-03-09T08:00:00.000Z", null, rule);
      assert.equal(instances.length, 180);
    });

    it("defaults to 6 months if no end date specified", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "daily",
      };
      const instances = expandRecurrence("2026-03-09T08:00:00.000Z", null, rule);
      assert.ok(instances.length > 0);
      assert.ok(instances.length <= 180);
      // Daily caps at 180 instances, so the last instance should be 179 days after start
      // (180 instances: index 0..179 = 180 days of events)
      // Mar 9 + 179 days = around Sep 4-5
      const firstDate = new Date(instances[0].start_date);
      const lastDate = new Date(instances[instances.length - 1].start_date);
      const daySpan = Math.round((lastDate.getTime() - firstDate.getTime()) / (24 * 3600000));
      assert.equal(daySpan, instances.length - 1, "Day span should match instance count minus 1");
    });
  });

  // ─── Monthly ────────────────────────────────────────────────────────

  describe("monthly", () => {
    it("generates monthly instances on the same day", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "monthly",
        day_of_month: 15,
        recurrence_end_date: "2026-08-31",
      };
      // Start Mar 15
      const instances = expandRecurrence("2026-03-15T14:00:00.000Z", "2026-03-15T16:00:00.000Z", rule);
      // Mar 15, Apr 15, May 15, Jun 15, Jul 15, Aug 15 = 6
      assert.equal(instances.length, 6);
      for (const inst of instances) {
        assert.equal(new Date(inst.start_date).getUTCDate(), 15);
      }
    });

    it("clamps to last day for short months", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "monthly",
        day_of_month: 31,
        recurrence_end_date: "2026-06-30",
      };
      // Start Jan 31
      const instances = expandRecurrence("2026-01-31T10:00:00.000Z", null, rule);
      // Jan 31, Feb 28, Mar 31, Apr 30, May 31, Jun 30 = 6
      assert.equal(instances.length, 6);

      const days = instances.map((inst) => new Date(inst.start_date).getUTCDate());
      assert.deepEqual(days, [31, 28, 31, 30, 31, 30]);
    });

    it("handles leap year February", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "monthly",
        day_of_month: 29,
        recurrence_end_date: "2028-03-31",
      };
      // 2028 is a leap year
      const instances = expandRecurrence("2028-01-29T12:00:00.000Z", null, rule);
      // Find the Feb instance
      const febInstance = instances.find((inst) => new Date(inst.start_date).getUTCMonth() === 1);
      assert.ok(febInstance, "Should have Feb instance");
      assert.equal(new Date(febInstance.start_date).getUTCDate(), 29, "Feb should be 29 in leap year");
    });

    it("caps at 12 instances", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "monthly",
        day_of_month: 1,
        recurrence_end_date: "2029-12-31",
      };
      const instances = expandRecurrence("2026-01-01T10:00:00.000Z", null, rule);
      assert.equal(instances.length, 12);
    });

    it("uses start date's day if day_of_month not specified", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "monthly",
        recurrence_end_date: "2026-06-30",
      };
      // Start on the 20th
      const instances = expandRecurrence("2026-03-20T10:00:00.000Z", null, rule);
      for (const inst of instances) {
        assert.equal(new Date(inst.start_date).getUTCDate(), 20);
      }
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns empty array for unknown occurrence type", () => {
      const rule = {
        occurrence_type: "biweekly" as "daily", // force bad type
      };
      const instances = expandRecurrence("2026-03-09T10:00:00.000Z", null, rule);
      assert.equal(instances.length, 0);
    });

    it("first instance index is always 0", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "weekly",
        day_of_week: [1],
        recurrence_end_date: "2026-03-16",
      };
      const instances = expandRecurrence("2026-03-09T10:00:00.000Z", null, rule);
      assert.equal(instances[0].recurrence_index, 0);
    });

    it("preserves time across all daily instances", () => {
      const rule: RecurrenceRule = {
        occurrence_type: "daily",
        recurrence_end_date: "2026-03-11",
      };
      const instances = expandRecurrence("2026-03-09T15:30:00.000Z", null, rule);
      for (const inst of instances) {
        const d = new Date(inst.start_date);
        assert.equal(d.getUTCHours(), 15);
        assert.equal(d.getUTCMinutes(), 30);
      }
    });
  });
});
