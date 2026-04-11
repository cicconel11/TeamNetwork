import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import { eventOverlapsRange } from "@/lib/calendar/event-segments";
import { localToUtcIso, resolveOrgTimezone } from "@/lib/utils/timezone";

export type UnifiedEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  sourceType: "event" | "schedule" | "feed" | "class";
  sourceName: string;
  badges: string[];
  eventId?: string;
  academicScheduleId?: string;
  color?: string;
  floatingDateKey?: string;
};

export type SourceType = "events" | "schedules" | "feeds" | "classes";

export type FetchUnifiedEventsOptions = {
  start: Date;
  end: Date;
  sources?: Set<SourceType>;
  timeZone?: string;
};

type UnifiedTeamEventRecord = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  event_type: string | null;
  is_philanthropy: boolean;
  recurrence_group_id: string | null;
};

const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseSourcesParam(sourcesParam: string | null): Set<SourceType> {
  if (!sourcesParam) {
    return new Set(["events", "schedules", "feeds", "classes"]);
  }
  const sources = sourcesParam.split(",").map((s) => s.trim()) as SourceType[];
  return new Set(sources.filter((s) => ["events", "schedules", "feeds", "classes"].includes(s)));
}

/**
 * Parse a YYYY-MM-DD string as a local date (midnight local time).
 * Avoids the UTC-parsing pitfall of `new Date("2026-03-15")` which creates
 * a UTC midnight that can shift to the previous day in US timezones.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a Date as YYYY-MM-DD in local time.
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isPlainDateString(value: string | null | undefined): boolean {
  return typeof value === "string" && PLAIN_DATE_PATTERN.test(value);
}

function asRecord(value: Json | Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeAllDayBoundary(value: string): string {
  return isPlainDateString(value) ? value : value.slice(0, 10);
}

function getCalendarEventFloatingDateKey(
  provider: string | null | undefined,
  raw: Json | null,
  allDay: boolean,
): string | null {
  if (!allDay) {
    return null;
  }

  const rawRecord = asRecord(raw);
  if (!rawRecord) {
    return null;
  }

  if (provider === "google") {
    const startRecord = asRecord(rawRecord.start as Json | Record<string, unknown> | null | undefined);
    const googleDate = typeof startRecord?.date === "string" ? startRecord.date : null;
    return isPlainDateString(googleDate) ? googleDate : null;
  }

  if (provider === "ics") {
    const dateKey = typeof rawRecord.dateKey === "string" ? rawRecord.dateKey : null;
    return isPlainDateString(dateKey) ? dateKey : null;
  }

  return null;
}

function getCalendarEventFloatingEndDateKey(
  provider: string | null | undefined,
  raw: Json | null,
  allDay: boolean,
): string | null {
  if (!allDay) {
    return null;
  }

  const rawRecord = asRecord(raw);
  if (!rawRecord) {
    return null;
  }

  if (provider === "google") {
    const endRecord = asRecord(rawRecord.end as Json | Record<string, unknown> | null | undefined);
    const googleDate = typeof endRecord?.date === "string" ? endRecord.date : null;
    return isPlainDateString(googleDate) ? googleDate : null;
  }

  if (provider === "ics") {
    const endDateKey = typeof rawRecord.endDateKey === "string" ? rawRecord.endDateKey : null;
    return isPlainDateString(endDateKey) ? endDateKey : null;
  }

  return null;
}

export function getUnifiedEventFloatingDateKey(
  event: Pick<UnifiedEvent, "allDay" | "startAt" | "floatingDateKey">,
): string | null {
  if (!event.allDay) {
    return null;
  }

  const explicitFloatingDateKey = event.floatingDateKey;
  if (explicitFloatingDateKey && isPlainDateString(explicitFloatingDateKey)) {
    return explicitFloatingDateKey;
  }

  return isPlainDateString(event.startAt) ? event.startAt : null;
}

function getUnifiedEventSortTimestamp(event: UnifiedEvent, timeZone?: string): number {
  const floatingDateKey = getUnifiedEventFloatingDateKey(event);
  if (floatingDateKey) {
    return new Date(localToUtcIso(floatingDateKey, "00:00", resolveOrgTimezone(timeZone))).getTime();
  }

  return new Date(event.startAt).getTime();
}

function compareUnifiedEvents(a: UnifiedEvent, b: UnifiedEvent, timeZone?: string): number {
  const startDiff = getUnifiedEventSortTimestamp(a, timeZone) - getUnifiedEventSortTimestamp(b, timeZone);
  if (startDiff !== 0) {
    return startDiff;
  }

  if (a.allDay !== b.allDay) {
    return a.allDay ? -1 : 1;
  }

  return a.id.localeCompare(b.id);
}

export function sortUnifiedEvents(events: UnifiedEvent[], timeZone?: string): UnifiedEvent[] {
  return [...events].sort((a, b) => compareUnifiedEvents(a, b, timeZone));
}

export function buildUnifiedCalendarDateRange(now: Date = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 181, 23, 59, 59, 999)),
  };
}

export function buildUnifiedCalendarPastDateRange(now: Date = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, now.getUTCDate())),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)),
  };
}

function normalizeScheduleTime(time: string): string {
  return time.split(":").slice(0, 2).join(":");
}

export function normalizeUnifiedTeamEvent(event: UnifiedTeamEventRecord): UnifiedEvent {
  const badges: string[] = [];
  if (event.event_type) badges.push(event.event_type);
  if (event.is_philanthropy) badges.push("philanthropy");
  if (event.recurrence_group_id) badges.push("recurring");

  const allDay = isPlainDateString(event.start_date) || isPlainDateString(event.end_date);
  const startDateValue = event.start_date;
  const startAt = allDay
    ? normalizeAllDayBoundary(startDateValue)
    : startDateValue;
  const endDateValue = event.end_date;
  const inclusiveEndDate = endDateValue === null
    ? null
    : normalizeAllDayBoundary(endDateValue);
  const endAt = allDay
    ? addDaysToDateString(inclusiveEndDate ?? startAt, 1)
    : endDateValue;

  return {
    id: `event:${event.id}`,
    title: event.title,
    startAt,
    endAt,
    allDay,
    location: event.location,
    sourceType: "event",
    sourceName: "Team Event",
    badges,
    eventId: event.id,
  };
}

export function expandAcademicSchedule(
  schedule: {
    id: string;
    title: string;
    start_date: string;
    end_date: string | null;
    start_time: string;
    end_time: string;
    occurrence_type: string;
    day_of_week: number[] | null;
    day_of_month: number | null;
  },
  rangeStart: Date,
  rangeEnd: Date,
  timeZone?: string,
): UnifiedEvent[] {
  const events: UnifiedEvent[] = [];
  const resolvedTimeZone = resolveOrgTimezone(timeZone);
  const scheduleStart = parseLocalDate(schedule.start_date);
  const scheduleEnd = schedule.end_date ? parseLocalDate(schedule.end_date) : rangeEnd;

  const effectiveStart = new Date(Math.max(scheduleStart.getTime(), rangeStart.getTime()));
  const effectiveEnd = new Date(Math.min(scheduleEnd.getTime(), rangeEnd.getTime()));

  if (effectiveStart > effectiveEnd) {
    return events;
  }

  const createEvent = (date: Date): UnifiedEvent | null => {
    const dateStr = toLocalDateString(date);
    try {
      const startAt = localToUtcIso(dateStr, normalizeScheduleTime(schedule.start_time), resolvedTimeZone);
      const endAt = localToUtcIso(dateStr, normalizeScheduleTime(schedule.end_time), resolvedTimeZone);

      return {
        id: `class:${schedule.id}:${dateStr}`,
        title: schedule.title,
        startAt,
        endAt,
        allDay: false,
        location: null,
        sourceType: "class",
        sourceName: schedule.title,
        badges: [],
        academicScheduleId: schedule.id,
      };
    } catch (error) {
      if (error instanceof RangeError) {
        return null;
      }
      throw error;
    }
  };

  if (schedule.occurrence_type === "single") {
    // Only emit if the single occurrence falls within the requested range
    if (scheduleStart >= rangeStart && scheduleStart <= rangeEnd) {
      const event = createEvent(scheduleStart);
      if (event) {
        events.push(event);
      }
    }
  } else if (schedule.occurrence_type === "daily") {
    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      const event = createEvent(new Date(current));
      if (event) {
        events.push(event);
      }
      current.setDate(current.getDate() + 1);
    }
  } else if (schedule.occurrence_type === "weekly" && schedule.day_of_week) {
    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (schedule.day_of_week.includes(current.getDay())) {
        const event = createEvent(new Date(current));
        if (event) {
          events.push(event);
        }
      }
      current.setDate(current.getDate() + 1);
    }
  } else if (schedule.occurrence_type === "monthly" && schedule.day_of_month) {
    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (current.getDate() === schedule.day_of_month) {
        const event = createEvent(new Date(current));
        if (event) {
          events.push(event);
        }
      }
      current.setDate(current.getDate() + 1);
    }
  }

  return events;
}

async function fetchEvents(
  supabase: SupabaseClient,
  orgId: string,
  start: Date,
  end: Date
): Promise<UnifiedEvent[]> {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("id, title, start_date, end_date, location, event_type, is_philanthropy, recurrence_group_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .lte("start_date", end.toISOString())
      .or(`end_date.gte.${start.toISOString()},end_date.is.null`)
      .order("start_date", { ascending: true });

    if (error) {
      console.error("[unified-events] Failed to fetch events:", error);
      return [];
    }
    if (!data) return [];

    const normalizedEvents = data.map((event) => normalizeUnifiedTeamEvent(event));
    return normalizedEvents.filter((event) => eventOverlapsRange(event, start, end));
  } catch (error) {
    console.error("[unified-events] Error querying events:", error);
    return [];
  }
}

async function fetchScheduleEvents(
  supabase: SupabaseClient,
  orgId: string,
  start: Date,
  end: Date
): Promise<UnifiedEvent[]> {
  try {
    const { data, error } = await supabase
      .from("schedule_events")
      .select("id, title, start_at, end_at, location, status, source_id, schedule_sources(title)")
      .eq("org_id", orgId)
      .neq("status", "cancelled")
      .lte("start_at", end.toISOString())
      .gte("end_at", start.toISOString())
      .order("start_at", { ascending: true });

    if (error) {
      console.error("[unified-events] Failed to fetch schedule events:", error);
      return [];
    }
    if (!data) return [];

    return data.map((event): UnifiedEvent => {
      const sourceObj = event.schedule_sources;
      const sourceTitle = Array.isArray(sourceObj)
        ? (sourceObj[0] as Record<string, unknown> | undefined)?.title as string | undefined
        : (sourceObj as Record<string, unknown> | null)?.title as string | undefined;

      return {
        id: `schedule:${event.id}`,
        title: event.title,
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: false,
        location: event.location,
        sourceType: "schedule",
        sourceName: sourceTitle || "Imported Schedule",
        badges: [],
      };
    });
  } catch (error) {
    console.error("[unified-events] Error querying schedule_events:", error);
    return [];
  }
}

async function fetchCalendarEvents(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  start: Date,
  end: Date
): Promise<UnifiedEvent[]> {
  try {
    const { data, error } = await supabase
      .from("calendar_events")
      .select("id, title, start_at, end_at, all_day, location, raw, feed_id, scope, user_id, calendar_feeds(provider)")
      .eq("organization_id", orgId)
      .or(`scope.eq.org,user_id.eq.${userId}`)
      .lte("start_at", end.toISOString())
      .or(`end_at.gte.${start.toISOString()},end_at.is.null`)
      .order("start_at", { ascending: true });

    if (error) {
      console.error("[unified-events] Failed to fetch calendar events:", error);
      return [];
    }
    if (!data) return [];

    return data.flatMap((event): UnifiedEvent[] => {
      const feed = Array.isArray(event.calendar_feeds)
        ? event.calendar_feeds[0]
        : event.calendar_feeds;
      const provider = (feed as { provider?: string } | null)?.provider;
      const sourceName = provider === "google"
        ? "Google Calendar"
        : "Calendar Feed";
      const floatingDateKey = getCalendarEventFloatingDateKey(provider, event.raw ?? null, event.all_day || false);
      const floatingEndDateKey = getCalendarEventFloatingEndDateKey(provider, event.raw ?? null, event.all_day || false);

      const overlapsRange = eventOverlapsRange({
        startAt: floatingDateKey ?? event.start_at,
        endAt: floatingEndDateKey ?? event.end_at,
        allDay: Boolean(event.all_day),
      }, start, end);

      if (!overlapsRange) {
        return [];
      }

      return [{
        id: `feed:${event.id}`,
        title: event.title || "Untitled Event",
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: event.all_day || false,
        location: event.location,
        sourceType: "feed",
        sourceName,
        badges: [],
        floatingDateKey: floatingDateKey ?? undefined,
      }];
    });
  } catch (error) {
    console.error("[unified-events] Error querying calendar_events:", error);
    return [];
  }
}

async function fetchAcademicScheduleEvents(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  start: Date,
  end: Date,
  timeZone?: string,
): Promise<UnifiedEvent[]> {
  try {
    const { data, error } = await supabase
      .from("academic_schedules")
      .select("id, title, start_date, end_date, start_time, end_time, occurrence_type, day_of_week, day_of_month")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (error) {
      console.error("[unified-events] Failed to fetch academic schedules:", error);
      return [];
    }
    if (!data) return [];

    const expanded: UnifiedEvent[] = [];
    for (const schedule of data) {
      const events = expandAcademicSchedule(schedule, start, end, timeZone);
      expanded.push(...events);
    }
    return expanded;
  } catch (error) {
    console.error("[unified-events] Error querying academic_schedules:", error);
    return [];
  }
}

/**
 * Fetch all unified calendar events for an org/user combination in parallel.
 *
 * The `userId` parameter is required for:
 * - Google Calendar scoping (`calendar_events` filters by `scope.eq.org` OR `user_id.eq.${userId}`)
 * - Academic schedule scoping (`academic_schedules` is per-user)
 */
export async function fetchUnifiedEvents(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  { start, end, sources, timeZone }: FetchUnifiedEventsOptions,
): Promise<UnifiedEvent[]> {
  const activeSources = sources ?? new Set<SourceType>(["events", "schedules", "feeds", "classes"]);
  const resolvedTimeZone = resolveOrgTimezone(timeZone);

  const [eventsResult, schedulesResult, feedsResult, classesResult] = await Promise.all([
    activeSources.has("events") ? fetchEvents(supabase, orgId, start, end) : Promise.resolve([]),
    activeSources.has("schedules") ? fetchScheduleEvents(supabase, orgId, start, end) : Promise.resolve([]),
    activeSources.has("feeds") ? fetchCalendarEvents(supabase, orgId, userId, start, end) : Promise.resolve([]),
    activeSources.has("classes") ? fetchAcademicScheduleEvents(supabase, orgId, userId, start, end, resolvedTimeZone) : Promise.resolve([]),
  ]);

  const allEvents = [...eventsResult, ...schedulesResult, ...feedsResult, ...classesResult];
  return sortUnifiedEvents(allEvents, resolvedTimeZone);
}
