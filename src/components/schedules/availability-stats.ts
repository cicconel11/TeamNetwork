/**
 * Pure computation logic for availability grid summary stats.
 * Extracted for testability — no React or Next.js dependencies.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 9pm (last slot is 9-10pm)

export type ConflictInfo = {
  userId: string;
  memberName: string;
  title: string;
  isOrg?: boolean;
};

type PersonalStats = { freeHours: number; busyHours: number };
type TeamStats = { avgAvailability: number; bestTime: string; teamSize: number };
export type SummaryStats = PersonalStats | TeamStats;

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function computeSummaryStats(
  conflictGrid: Map<string, ConflictInfo[]>,
  weekDays: Date[],
  mode: "personal" | "team",
  totalMembers: number,
): SummaryStats {
  const totalSlots = HOURS.length * weekDays.length;

  if (mode === "personal") {
    let busySlots = 0;
    weekDays.forEach((day) => {
      const dateKey = formatDateKey(day);
      HOURS.forEach((hour) => {
        const conflicts = conflictGrid.get(`${dateKey}-${hour}`);
        if (conflicts && conflicts.length > 0) {
          busySlots++;
        }
      });
    });
    return { freeHours: totalSlots - busySlots, busyHours: busySlots };
  }

  // Team mode
  let totalAvailability = 0;
  let bestSlot = { day: "", hour: 0, availability: -1 };

  weekDays.forEach((day) => {
    const dateKey = formatDateKey(day);
    HOURS.forEach((hour) => {
      const conflicts = conflictGrid.get(`${dateKey}-${hour}`);
      const busyCount = conflicts ? conflicts.length : 0;
      const orgBusy = conflicts?.some((c) => c.isOrg) || false;
      const effectiveBusy = orgBusy ? totalMembers : busyCount;
      const available = totalMembers > 0 ? Math.max(totalMembers - effectiveBusy, 0) / totalMembers : 0;
      totalAvailability += available;

      if (available > bestSlot.availability) {
        bestSlot = { day: DAYS[day.getDay()], hour, availability: available };
      }
    });
  });

  const avgAvailability = totalSlots > 0 ? Math.round((totalAvailability / totalSlots) * 100) : 0;
  const bestTime = bestSlot.availability > 0
    ? `${bestSlot.day} ${bestSlot.hour % 12 || 12}${bestSlot.hour < 12 ? "am" : "pm"}`
    : "—";

  return { avgAvailability, bestTime, teamSize: totalMembers };
}
