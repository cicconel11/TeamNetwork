export type CalendarEventLike = {
  startAt: string;
  endAt: string | null;
  allDay: boolean;
};

export type LocalEventSegment = {
  date: Date;
  dateKey: string;
  startMinute: number;
  endMinute: number;
  isStart: boolean;
  isEnd: boolean;
  spansFullDay: boolean;
};

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseEventDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseFloatingDate(value: string | null): Date | null {
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day);
}

function getDateTimeParts(date: Date, timeZone?: string): DateTimeParts {
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

function toDateKeyFromParts(parts: Pick<DateTimeParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateFromDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function buildDateTimeFormatOptions(
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  return timeZone ? { ...options, timeZone } : options;
}

function formatMonthDay(date: Date, locale: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat(
    locale,
    buildDateTimeFormatOptions(timeZone, {
      month: "short",
      day: "numeric",
    }),
  ).formatToParts(date);

  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${month} ${day}`.trim();
}

function formatTime(date: Date, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(
    locale,
    buildDateTimeFormatOptions(timeZone, {
      hour: "numeric",
      minute: "2-digit",
    }),
  ).format(date);
}

function resolveEventRange(event: CalendarEventLike) {
  const start = event.allDay ? parseFloatingDate(event.startAt) : parseEventDate(event.startAt);
  if (!start) return null;

  const parsedEnd = event.allDay ? parseFloatingDate(event.endAt) : parseEventDate(event.endAt);
  const end = parsedEnd && parsedEnd.getTime() >= start.getTime()
    ? parsedEnd
    : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);

  return { start, end };
}

function resolveOverlapEnd(event: CalendarEventLike, start: Date, end: Date): Date {
  // All-day end timestamps are stored as the first instant after the visible range.
  if (event.allDay && event.endAt && end.getTime() > start.getTime()) {
    return new Date(end.getTime() - 1);
  }

  return end;
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function splitEventIntoLocalDaySegments(
  event: CalendarEventLike,
  timeZone?: string,
): LocalEventSegment[] {
  const range = resolveEventRange(event);
  if (!range) return [];

  const { start, end } = range;
  const segments: LocalEventSegment[] = [];

  if (event.allDay) {
    const startDay = startOfLocalDay(start);
    const endDay = startOfLocalDay(end);
    const endIsMidnight = end.getHours() === 0 && end.getMinutes() === 0;
    const inclusiveEnd = endIsMidnight && endDay.getTime() > startDay.getTime()
      ? addDays(endDay, -1)
      : endDay;

    for (let day = new Date(startDay); day.getTime() <= inclusiveEnd.getTime(); day = addDays(day, 1)) {
      const dateKey = toLocalDateKey(day);
      segments.push({
        date: dateFromDateKey(dateKey),
        dateKey,
        startMinute: 0,
        endMinute: 24 * 60,
        isStart: day.getTime() === startDay.getTime(),
        isEnd: day.getTime() === inclusiveEnd.getTime(),
        spansFullDay: true,
      });
    }

    return segments;
  }

  const startParts = getDateTimeParts(start, timeZone);
  const endParts = getDateTimeParts(end, timeZone);
  const startDayKey = toDateKeyFromParts(startParts);
  const endDayKey = toDateKeyFromParts(endParts);

  for (let dateKey = startDayKey; dateKey <= endDayKey; dateKey = addDaysToDateKey(dateKey, 1)) {
    const isStart = dateKey === startDayKey;
    const isEnd = dateKey === endDayKey;
    const startMinute = isStart ? (startParts.hour * 60) + startParts.minute : 0;
    const endMinute = isEnd ? (endParts.hour * 60) + endParts.minute : 24 * 60;

    if (startMinute >= endMinute) {
      continue;
    }

    segments.push({
      date: dateFromDateKey(dateKey),
      dateKey,
      startMinute,
      endMinute,
      isStart,
      isEnd,
      spansFullDay: startMinute === 0 && endMinute === 24 * 60,
    });
  }

  return segments;
}

export function formatCalendarEventTime(event: CalendarEventLike, locale = "en-US", timeZone?: string): string {
  const range = resolveEventRange(event);
  if (!range) return "";
  if (event.allDay) return "All day";

  const { start, end } = range;
  const startTime = formatTime(start, locale, timeZone);
  if (!event.endAt) {
    return startTime;
  }

  if (toDateKeyFromParts(getDateTimeParts(start, timeZone)) === toDateKeyFromParts(getDateTimeParts(end, timeZone))) {
    const endTime = formatTime(end, locale, timeZone);
    return `${startTime} – ${endTime}`;
  }

  return `${formatMonthDay(start, locale, timeZone)}, ${startTime} – ${formatMonthDay(end, locale, timeZone)}, ${formatTime(end, locale, timeZone)}`;
}

export function eventOverlapsRange(event: CalendarEventLike, start: Date, end: Date): boolean {
  const range = resolveEventRange(event);
  if (!range) return false;

  if (event.allDay) {
    if (event.endAt && event.startAt.includes("T") && event.endAt.includes("T")) {
      const exactStart = parseEventDate(event.startAt);
      const exactEnd = parseEventDate(event.endAt);

      if (exactStart && exactEnd) {
        const inclusiveEnd = new Date(exactEnd.getTime() - 1);
        return exactStart.getTime() <= end.getTime() &&
          inclusiveEnd.getTime() >= start.getTime();
      }
    }

    const eventStartDay = startOfLocalDay(range.start);
    const eventEndDay = !event.endAt
      ? eventStartDay
      : (() => {
          const endDay = startOfLocalDay(range.end);
          const endsAtLocalMidnight =
            range.end.getHours() === 0 &&
            range.end.getMinutes() === 0 &&
            range.end.getSeconds() === 0 &&
            range.end.getMilliseconds() === 0;

          return endsAtLocalMidnight && endDay.getTime() > eventStartDay.getTime()
            ? addDays(endDay, -1)
            : endDay;
        })();

    const rangeStartDay = startOfLocalDay(start);
    const rangeEndDay = startOfLocalDay(end);

    return eventStartDay.getTime() <= rangeEndDay.getTime() &&
      eventEndDay.getTime() >= rangeStartDay.getTime();
  }

  const overlapEnd = resolveOverlapEnd(event, range.start, range.end);
  const startsBeforeRangeEnds = range.start.getTime() <= end.getTime();

  return startsBeforeRangeEnds && overlapEnd.getTime() >= start.getTime();
}
