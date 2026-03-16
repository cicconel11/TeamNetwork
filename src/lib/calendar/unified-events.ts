import type { SupabaseClient } from "@supabase/supabase-js";

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
  color?: string;
};

export type SourceType = "events" | "schedules" | "feeds" | "classes";

export type FetchUnifiedEventsOptions = {
  start: Date;
  end: Date;
  sources?: Set<SourceType>;
};

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
  rangeEnd: Date
): UnifiedEvent[] {
  const events: UnifiedEvent[] = [];
  const scheduleStart = parseLocalDate(schedule.start_date);
  const scheduleEnd = schedule.end_date ? parseLocalDate(schedule.end_date) : rangeEnd;

  const effectiveStart = new Date(Math.max(scheduleStart.getTime(), rangeStart.getTime()));
  const effectiveEnd = new Date(Math.min(scheduleEnd.getTime(), rangeEnd.getTime()));

  if (effectiveStart > effectiveEnd) {
    return events;
  }

  const createEvent = (date: Date): UnifiedEvent => {
    const dateStr = toLocalDateString(date);
    const startDateTime = new Date(`${dateStr}T${schedule.start_time}`);
    const endDateTime = new Date(`${dateStr}T${schedule.end_time}`);

    return {
      id: `class:${schedule.id}:${dateStr}`,
      title: schedule.title,
      startAt: startDateTime.toISOString(),
      endAt: endDateTime.toISOString(),
      allDay: false,
      location: null,
      sourceType: "class",
      sourceName: schedule.title,
      badges: [],
    };
  };

  if (schedule.occurrence_type === "single") {
    // Only emit if the single occurrence falls within the requested range
    if (scheduleStart >= rangeStart && scheduleStart <= rangeEnd) {
      events.push(createEvent(scheduleStart));
    }
  } else if (schedule.occurrence_type === "daily") {
    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      events.push(createEvent(new Date(current)));
      current.setDate(current.getDate() + 1);
    }
  } else if (schedule.occurrence_type === "weekly" && schedule.day_of_week) {
    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (schedule.day_of_week.includes(current.getDay())) {
        events.push(createEvent(new Date(current)));
      }
      current.setDate(current.getDate() + 1);
    }
  } else if (schedule.occurrence_type === "monthly" && schedule.day_of_month) {
    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (current.getDate() === schedule.day_of_month) {
        events.push(createEvent(new Date(current)));
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

    const overlapping = data.filter((event) => {
      const eventStart = new Date(event.start_date);
      const eventEnd = event.end_date ? new Date(event.end_date) : null;
      return eventStart <= end && (eventEnd ? eventEnd >= start : eventStart >= start);
    });

    return overlapping.map((event): UnifiedEvent => {
      const badges: string[] = [];
      if (event.event_type) badges.push(event.event_type);
      if (event.is_philanthropy) badges.push("philanthropy");
      if (event.recurrence_group_id) badges.push("recurring");

      return {
        id: `event:${event.id}`,
        title: event.title,
        startAt: event.start_date,
        endAt: event.end_date,
        allDay: false,
        location: event.location,
        sourceType: "event",
        sourceName: "Team Event",
        badges,
        eventId: event.id,
      };
    });
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
      .select("id, title, start_at, end_at, all_day, location, feed_id, scope, user_id, calendar_feeds(provider)")
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

    const overlapping = data.filter((event) => {
      const eventStart = new Date(event.start_at);
      const eventEnd = event.end_at ? new Date(event.end_at) : null;
      return eventStart <= end && (eventEnd ? eventEnd >= start : eventStart >= start);
    });

    return overlapping.map((event): UnifiedEvent => {
      const feed = Array.isArray(event.calendar_feeds)
        ? event.calendar_feeds[0]
        : event.calendar_feeds;
      const sourceName = (feed as { provider?: string } | null)?.provider === "google"
        ? "Google Calendar"
        : "Calendar Feed";

      return {
        id: `feed:${event.id}`,
        title: event.title || "Untitled Event",
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: event.all_day || false,
        location: event.location,
        sourceType: "feed",
        sourceName,
        badges: [],
      };
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
  end: Date
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
      const events = expandAcademicSchedule(schedule, start, end);
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
  { start, end, sources }: FetchUnifiedEventsOptions
): Promise<UnifiedEvent[]> {
  const activeSources = sources ?? new Set<SourceType>(["events", "schedules", "feeds", "classes"]);

  const [eventsResult, schedulesResult, feedsResult, classesResult] = await Promise.all([
    activeSources.has("events") ? fetchEvents(supabase, orgId, start, end) : Promise.resolve([]),
    activeSources.has("schedules") ? fetchScheduleEvents(supabase, orgId, start, end) : Promise.resolve([]),
    activeSources.has("feeds") ? fetchCalendarEvents(supabase, orgId, userId, start, end) : Promise.resolve([]),
    activeSources.has("classes") ? fetchAcademicScheduleEvents(supabase, orgId, userId, start, end) : Promise.resolve([]),
  ]);

  const allEvents = [...eventsResult, ...schedulesResult, ...feedsResult, ...classesResult];

  allEvents.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  return allEvents;
}
