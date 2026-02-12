/**
 * Pure functions for computing positioned event blocks in the availability grid.
 * Used by personal mode to render Google Calendar-style event pills.
 */

export type EventBlock = {
  id: string;
  startMinute: number; // minutes since midnight (e.g. 540 = 9:00 AM)
  endMinute: number;
  title: string;
  memberName: string;
  userId: string;
  isOrg: boolean;
  origin: "calendar" | "schedule" | "academic";
};

export type PositionedBlock = EventBlock & {
  column: number; // 0-based column index for side-by-side layout
  totalColumns: number; // total columns in this overlap group
};

type ScheduleInput = {
  id?: string;
  user_id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string;
  end_time: string;
  occurrence_type: string;
  day_of_week: number | number[] | null;
  day_of_month: number | null;
  users?: { name: string | null; email: string | null } | null;
};

type CalendarEventInput = {
  id: string;
  user_id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  users?: { name: string | null; email: string | null } | null;
  origin?: "calendar" | "schedule";
};

const GRID_START_HOUR = 6;
const GRID_END_HOUR = 22; // 10pm
const GRID_START_MINUTE = GRID_START_HOUR * 60;
const GRID_END_MINUTE = GRID_END_HOUR * 60;

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Compute event blocks for each day from academic schedules and calendar events.
 * Returns a Map keyed by date string (YYYY-MM-DD) → EventBlock[].
 */
export function computeEventBlocks(
  schedules: ScheduleInput[],
  calendarEvents: CalendarEventInput[],
  weekDays: Date[],
): Map<string, EventBlock[]> {
  const blocks = new Map<string, EventBlock[]>();

  const addBlock = (dateKey: string, block: EventBlock) => {
    // Clamp to grid bounds
    const clamped = {
      ...block,
      startMinute: Math.max(block.startMinute, GRID_START_MINUTE),
      endMinute: Math.min(block.endMinute, GRID_END_MINUTE),
    };
    if (clamped.startMinute >= clamped.endMinute) return;

    const existing = blocks.get(dateKey) || [];
    existing.push(clamped);
    blocks.set(dateKey, existing);
  };

  // Process academic schedules
  schedules.forEach((schedule) => {
    const scheduleStart = parseLocalDate(schedule.start_date);
    const scheduleEnd = schedule.end_date ? parseLocalDate(schedule.end_date) : null;
    const [startH, startM] = schedule.start_time.split(":").map(Number);
    const [endH, endM] = schedule.end_time.split(":").map(Number);
    const startMin = startH * 60 + (startM || 0);
    const endMin = endH * 60 + (endM || 0);
    const memberName = schedule.users?.name || schedule.users?.email || "You";

    weekDays.forEach((dayDate) => {
      const dayOnly = startOfDay(dayDate);
      const startOnly = startOfDay(scheduleStart);
      const endOnly = scheduleEnd ? startOfDay(scheduleEnd) : null;

      if (dayOnly < startOnly) return;
      if (endOnly && dayOnly > endOnly) return;

      let applies = false;
      switch (schedule.occurrence_type) {
        case "single":
          applies = dayOnly.getTime() === startOnly.getTime();
          break;
        case "daily":
          applies = true;
          break;
        case "weekly":
          applies = Array.isArray(schedule.day_of_week)
            ? schedule.day_of_week.includes(dayDate.getDay())
            : schedule.day_of_week === dayDate.getDay();
          break;
        case "monthly":
          applies = schedule.day_of_month === dayDate.getDate();
          break;
        default:
          applies = false;
      }

      if (!applies) return;

      const dateKey = formatDateKey(dayDate);
      addBlock(dateKey, {
        id: `sched-${schedule.id || schedule.user_id}-${dateKey}`,
        startMinute: startMin,
        endMinute: endMin,
        title: schedule.title,
        memberName,
        userId: schedule.user_id,
        isOrg: false,
        origin: "academic",
      });
    });
  });

  // Process calendar events
  calendarEvents.forEach((event) => {
    const start = new Date(event.start_at);
    if (Number.isNaN(start.getTime())) return;

    const end = event.end_at ? new Date(event.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
    const isOrgEvent = event.origin === "schedule";
    const memberName = isOrgEvent
      ? "Org schedule"
      : event.users?.name || event.users?.email || "You";
    const title = event.title || (isOrgEvent ? "Org schedule" : "Calendar event");

    if (event.all_day) {
      // All-day events: render as a full-grid-height block for each day
      const startDay = startOfDay(start);
      const endDay = startOfDay(end);
      const endIsMidnight = end.getHours() === 0 && end.getMinutes() === 0;
      const inclusiveEnd = endIsMidnight && endDay > startDay
        ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 1)
        : endDay;

      for (let day = new Date(startDay); day <= inclusiveEnd; day.setDate(day.getDate() + 1)) {
        const dateKey = formatDateKey(day);
        if (!weekDays.some((wd) => formatDateKey(wd) === dateKey)) continue;

        addBlock(dateKey, {
          id: `cal-${event.id}-${dateKey}`,
          startMinute: GRID_START_MINUTE,
          endMinute: GRID_END_MINUTE,
          title,
          memberName,
          userId: isOrgEvent ? `org:${event.id}` : event.user_id,
          isOrg: isOrgEvent,
          origin: isOrgEvent ? "schedule" : "calendar",
        });
      }
      return;
    }

    // Timed events: may span multiple days
    const startDay = startOfDay(start);
    const endDay = startOfDay(end);

    for (let day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
      const dateKey = formatDateKey(day);
      if (!weekDays.some((wd) => formatDateKey(wd) === dateKey)) continue;

      const isFirstDay = day.getTime() === startDay.getTime();
      const isLastDay = day.getTime() === endDay.getTime();

      const dayStartMin = isFirstDay ? start.getHours() * 60 + start.getMinutes() : 0;
      const dayEndMin = isLastDay ? end.getHours() * 60 + end.getMinutes() : 24 * 60;

      addBlock(dateKey, {
        id: `cal-${event.id}-${dateKey}`,
        startMinute: dayStartMin,
        endMinute: dayEndMin,
        title,
        memberName,
        userId: isOrgEvent ? `org:${event.id}` : event.user_id,
        isOrg: isOrgEvent,
        origin: isOrgEvent ? "schedule" : "calendar",
      });
    }
  });

  return blocks;
}

/**
 * Resolve overlapping event blocks into positioned columns using greedy interval coloring.
 * Events that overlap in time are placed side-by-side in separate columns.
 */
export function resolveOverlaps(blocks: EventBlock[]): PositionedBlock[] {
  if (blocks.length === 0) return [];

  // Sort by start time, then by duration (longer first for better visual layout)
  const sorted = [...blocks].sort((a, b) => {
    if (a.startMinute !== b.startMinute) return a.startMinute - b.startMinute;
    return (b.endMinute - b.startMinute) - (a.endMinute - a.startMinute);
  });

  // Build overlap groups (connected components of overlapping events)
  const groups: EventBlock[][] = [];
  let currentGroup: EventBlock[] = [];
  let groupEnd = -1;

  for (const block of sorted) {
    if (currentGroup.length === 0 || block.startMinute < groupEnd) {
      currentGroup.push(block);
      groupEnd = Math.max(groupEnd, block.endMinute);
    } else {
      groups.push(currentGroup);
      currentGroup = [block];
      groupEnd = block.endMinute;
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // Assign columns within each group
  const result: PositionedBlock[] = [];

  for (const group of groups) {
    const columns: EventBlock[][] = [];

    for (const block of group) {
      // Find first column where this block doesn't overlap
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        const lastInCol = columns[col][columns[col].length - 1];
        if (lastInCol.endMinute <= block.startMinute) {
          columns[col].push(block);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([block]);
      }
    }

    const totalColumns = columns.length;
    columns.forEach((col, colIndex) => {
      col.forEach((block) => {
        result.push({
          ...block,
          column: colIndex,
          totalColumns,
        });
      });
    });
  }

  return result;
}
