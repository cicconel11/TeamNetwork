import { localToUtcIso, resolveOrgTimezone } from "@/lib/utils/timezone";

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type CurrentTimeMarker = {
  dateKey: string;
  minute: number;
};

export type AvailabilityWeekContext = {
  weekStart: Date;
  weekEnd: Date;
  weekLabel: string;
  weekDays: Date[];
  rangeStart: Date;
  rangeEnd: Date;
  todayKey: string;
};

export type AvailabilityRenderState = AvailabilityWeekContext & {
  currentMinute: number;
};

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getLocalDateTimeParts(date: Date, timeZone?: string): LocalDateTimeParts {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const hour = value("hour");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: hour === 24 ? 0 : hour,
    minute: value("minute"),
  };
}

function formatWeekLabel(weekStart: Date, weekEnd: Date): string {
  const startMonth = weekStart.toLocaleDateString("en-US", { month: "short" });
  const endMonth = weekEnd.toLocaleDateString("en-US", { month: "short" });
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();

  return sameMonth
    ? `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    : `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
}

export function getCurrentTimeMarker(now: Date, timeZone?: string): CurrentTimeMarker {
  const tz = timeZone ? resolveOrgTimezone(timeZone) : undefined;
  const parts = getLocalDateTimeParts(now, tz);

  return {
    dateKey: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    minute: (parts.hour * 60) + parts.minute,
  };
}

export function buildAvailabilityWeek(now: Date, weekOffset: number, timeZone?: string): AvailabilityWeekContext {
  const tz = resolveOrgTimezone(timeZone);
  const { dateKey: todayKey } = getCurrentTimeMarker(now, tz);
  const today = parseDateKey(todayKey);
  const weekStart = addDays(today, (-1 * today.getDay()) + (weekOffset * 7));
  const weekEnd = addDays(weekStart, 6);
  const nextWeekStart = addDays(weekStart, 7);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const rangeStart = new Date(localToUtcIso(formatDateKey(weekStart), "00:00", tz));
  const nextWeekStartUtc = new Date(localToUtcIso(formatDateKey(nextWeekStart), "00:00", tz));
  const rangeEnd = new Date(nextWeekStartUtc.getTime() - 1);

  return {
    weekStart,
    weekEnd,
    weekLabel: formatWeekLabel(weekStart, weekEnd),
    weekDays,
    rangeStart,
    rangeEnd,
    todayKey,
  };
}

export function buildAvailabilityRenderState(now: Date, weekOffset: number, timeZone?: string): AvailabilityRenderState {
  const week = buildAvailabilityWeek(now, weekOffset, timeZone);
  const { minute: currentMinute } = getCurrentTimeMarker(now, timeZone);

  return {
    ...week,
    currentMinute,
  };
}
