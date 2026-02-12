import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSummaryStats,
  formatDateKey,
  type ConflictInfo,
} from "@/components/schedules/availability-stats";

// HOURS constant from the component: 6am to 9pm (16 slots)
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

// Build a week of dates starting from a Monday (2026-01-05 is a Monday)
function buildWeekDays(): Date[] {
  const start = new Date(2026, 0, 4); // Sunday Jan 4, 2026
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

describe("computeSummaryStats", () => {
  const weekDays = buildWeekDays();
  const totalSlots = HOURS.length * weekDays.length; // 16 * 7 = 112

  describe("team mode with totalMembers = 0", () => {
    it("returns avgAvailability=0, bestTime='—', teamSize=0", () => {
      const grid = new Map<string, ConflictInfo[]>();
      const result = computeSummaryStats(grid, weekDays, "team", 0);

      assert.ok("avgAvailability" in result);
      const teamResult = result as { avgAvailability: number; bestTime: string; teamSize: number };
      assert.equal(teamResult.avgAvailability, 0);
      assert.equal(teamResult.bestTime, "—");
      assert.equal(teamResult.teamSize, 0);
    });

    it("returns avgAvailability=0 even with conflicts in the grid", () => {
      const grid = new Map<string, ConflictInfo[]>();
      const dateKey = formatDateKey(weekDays[0]);
      grid.set(`${dateKey}-${HOURS[0]}`, [
        { userId: "u1", memberName: "Alice", title: "Meeting" },
      ]);

      const result = computeSummaryStats(grid, weekDays, "team", 0);
      assert.ok("avgAvailability" in result);
      const teamResult = result as { avgAvailability: number; bestTime: string; teamSize: number };
      assert.equal(teamResult.avgAvailability, 0);
      assert.equal(teamResult.bestTime, "—");
    });
  });

  describe("team mode with totalMembers > 0 and no conflicts", () => {
    it("returns avgAvailability=100 and a valid bestTime", () => {
      const grid = new Map<string, ConflictInfo[]>();
      const result = computeSummaryStats(grid, weekDays, "team", 5);

      assert.ok("avgAvailability" in result);
      const teamResult = result as { avgAvailability: number; bestTime: string; teamSize: number };
      assert.equal(teamResult.avgAvailability, 100);
      assert.notEqual(teamResult.bestTime, "—");
      assert.equal(teamResult.teamSize, 5);
      // bestTime should be a formatted slot like "Sun 6am"
      assert.match(teamResult.bestTime, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}(am|pm)$/);
    });
  });

  describe("team mode with partial conflicts", () => {
    it("reduces avgAvailability proportionally", () => {
      const grid = new Map<string, ConflictInfo[]>();
      // Fill every slot with 1 conflict out of 4 members → 75% availability per slot
      weekDays.forEach((day) => {
        const dateKey = formatDateKey(day);
        HOURS.forEach((hour) => {
          grid.set(`${dateKey}-${hour}`, [
            { userId: "u1", memberName: "Alice", title: "Class" },
          ]);
        });
      });

      const result = computeSummaryStats(grid, weekDays, "team", 4);
      assert.ok("avgAvailability" in result);
      const teamResult = result as { avgAvailability: number; bestTime: string; teamSize: number };
      assert.equal(teamResult.avgAvailability, 75);
      assert.notEqual(teamResult.bestTime, "—");
    });

    it("handles org events blocking all members", () => {
      const grid = new Map<string, ConflictInfo[]>();
      const dateKey = formatDateKey(weekDays[1]); // Monday
      // One slot with an org event → effectiveBusy = totalMembers → 0% for that slot
      grid.set(`${dateKey}-${HOURS[0]}`, [
        { userId: "org:evt1", memberName: "Org schedule", title: "Team meeting", isOrg: true },
      ]);

      const result = computeSummaryStats(grid, weekDays, "team", 10);
      assert.ok("avgAvailability" in result);
      const teamResult = result as { avgAvailability: number; bestTime: string; teamSize: number };
      // 111 slots at 100% + 1 slot at 0% → (111/112)*100 = ~99%
      assert.equal(teamResult.avgAvailability, 99);
    });
  });

  describe("personal mode", () => {
    it("counts free and busy hours correctly with no conflicts", () => {
      const grid = new Map<string, ConflictInfo[]>();
      const result = computeSummaryStats(grid, weekDays, "personal", 1);

      assert.ok("freeHours" in result);
      const personalResult = result as { freeHours: number; busyHours: number };
      assert.equal(personalResult.freeHours, totalSlots);
      assert.equal(personalResult.busyHours, 0);
    });

    it("counts busy slots correctly", () => {
      const grid = new Map<string, ConflictInfo[]>();
      // Add 3 busy slots
      for (let i = 0; i < 3; i++) {
        const dateKey = formatDateKey(weekDays[0]);
        grid.set(`${dateKey}-${HOURS[i]}`, [
          { userId: "me", memberName: "You", title: "Class" },
        ]);
      }

      const result = computeSummaryStats(grid, weekDays, "personal", 1);
      assert.ok("freeHours" in result);
      const personalResult = result as { freeHours: number; busyHours: number };
      assert.equal(personalResult.busyHours, 3);
      assert.equal(personalResult.freeHours, totalSlots - 3);
    });
  });
});
