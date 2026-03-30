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

function resolveEventRange(event: CalendarEventLike) {
  const start = event.allDay ? parseFloatingDate(event.startAt) : parseEventDate(event.startAt);
  if (!start) return null;

  const parsedEnd = event.allDay ? parseFloatingDate(event.endAt) : parseEventDate(event.endAt);
  const end = parsedEnd && parsedEnd.getTime() >= start.getTime()
    ? parsedEnd
    : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);

  return { start, end };
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function splitEventIntoLocalDaySegments(event: CalendarEventLike): LocalEventSegment[] {
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
      segments.push({
        date: new Date(day),
        dateKey: toLocalDateKey(day),
        startMinute: 0,
        endMinute: 24 * 60,
        isStart: day.getTime() === startDay.getTime(),
        isEnd: day.getTime() === inclusiveEnd.getTime(),
        spansFullDay: true,
      });
    }

    return segments;
  }

  const startDay = startOfLocalDay(start);
  const endDay = startOfLocalDay(end);

  for (let day = new Date(startDay); day.getTime() <= endDay.getTime(); day = addDays(day, 1)) {
    const isStart = day.getTime() === startDay.getTime();
    const isEnd = day.getTime() === endDay.getTime();
    const startMinute = isStart ? (start.getHours() * 60) + start.getMinutes() : 0;
    const endMinute = isEnd ? (end.getHours() * 60) + end.getMinutes() : 24 * 60;

    if (startMinute >= endMinute) {
      continue;
    }

    segments.push({
      date: new Date(day),
      dateKey: toLocalDateKey(day),
      startMinute,
      endMinute,
      isStart,
      isEnd,
      spansFullDay: startMinute === 0 && endMinute === 24 * 60,
    });
  }

  return segments;
}

export function formatCalendarEventTime(event: CalendarEventLike, locale = "en-US"): string {
  const range = resolveEventRange(event);
  if (!range) return "";
  if (event.allDay) return "All day";

  const { start, end } = range;
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };

  const startTime = start.toLocaleTimeString(locale, timeOptions);
  if (!event.endAt) {
    return startTime;
  }

  if (start.toDateString() === end.toDateString()) {
    const endTime = end.toLocaleTimeString(locale, timeOptions);
    return `${startTime} – ${endTime}`;
  }

  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };

  return `${start.toLocaleDateString(locale, dateTimeOptions)} – ${end.toLocaleDateString(locale, dateTimeOptions)}`;
}

export function eventOverlapsRange(event: CalendarEventLike, start: Date, end: Date): boolean {
  const range = resolveEventRange(event);
  if (!range) return false;

  return range.start.getTime() <= end.getTime()
    && (event.endAt ? range.end.getTime() >= start.getTime() : range.start.getTime() >= start.getTime());
}
