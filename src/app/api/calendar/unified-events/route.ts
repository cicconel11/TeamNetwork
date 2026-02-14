import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

const MAX_EVENTS = 2000;
const MAX_DATE_RANGE_DAYS = 400;

export const dynamic = "force-dynamic";

type UnifiedEvent = {
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

type SourceType = "events" | "schedules" | "feeds" | "classes";

function parseSourcesParam(sourcesParam: string | null): Set<SourceType> {
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
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a Date as YYYY-MM-DD in local time.
 */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function expandAcademicSchedule(
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

export async function GET(request: Request) {
  // IP-based rate limiting (before auth to prevent unauthenticated abuse)
  const ipRateLimit = checkRateLimit(request, {
    limitPerIp: 30,
    limitPerUser: 0,
    windowMs: 60_000,
    feature: "unified events",
  });
  if (!ipRateLimit.ok) {
    return buildRateLimitResponse(ipRateLimit);
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view events." },
        { status: 401 }
      );
    }

    // User-based rate limiting
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0,
      limitPerUser: 20,
      windowMs: 60_000,
      feature: "unified events",
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const sourcesParam = url.searchParams.get("sources");

    const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
    const limitParam = parseInt(url.searchParams.get("limit") || String(MAX_EVENTS), 10);
    const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limit = Number.isNaN(limitParam) || limitParam < 1 ? MAX_EVENTS : Math.min(limitParam, MAX_EVENTS);
    const offset = (page - 1) * limit;

    if (!orgId || !startParam || !endParam) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId, start, and end are required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked") {
      return NextResponse.json(
        { error: "Forbidden", message: "You are not a member of this organization." },
        { status: 403 }
      );
    }

    const start = new Date(startParam);
    const end = new Date(endParam);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json(
        { error: "Invalid parameters", message: "start and end must be valid ISO dates." },
        { status: 400 }
      );
    }

    if (start > end) {
      return NextResponse.json(
        { error: "Invalid parameters", message: "start must be before end." },
        { status: 400 }
      );
    }

    // Validate date range isn't too large
    const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (rangeDays > MAX_DATE_RANGE_DAYS) {
      return NextResponse.json(
        { error: "Invalid parameters", message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.` },
        { status: 400 }
      );
    }

    const sources = parseSourcesParam(sourcesParam);
    const allEvents: UnifiedEvent[] = [];

    // 1. Query events table
    // Use broad DB bounds then enforce exact overlap in code:
    // event overlaps window if start <= rangeEnd AND (end >= rangeStart OR (end is null AND start >= rangeStart))
    if (sources.has("events")) {
      try {
        const { data: eventsData, error: eventsError } = await supabase
          .from("events")
          .select("id, title, start_date, end_date, location, event_type, audience, is_philanthropy, recurrence_group_id, deleted_at, organization_id")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .lte("start_date", end.toISOString())
          .order("start_date", { ascending: true });

        if (eventsError) {
          console.error("[unified-events] Failed to fetch events:", eventsError);
        } else if (eventsData) {
          const overlappingEvents = eventsData.filter((event) => {
            const eventStart = new Date(event.start_date);
            const eventEnd = event.end_date ? new Date(event.end_date) : null;
            return eventStart <= end && (eventEnd ? eventEnd >= start : eventStart >= start);
          });
          const normalized = overlappingEvents.map((event): UnifiedEvent => {
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
          allEvents.push(...normalized);
        }
      } catch (error) {
        console.error("[unified-events] Error querying events:", error);
      }
    }

    // 2. Query schedule_events table
    // Overlap: start_at < rangeEnd AND end_at >= rangeStart
    if (sources.has("schedules")) {
      try {
        const { data: scheduleData, error: scheduleError } = await supabase
          .from("schedule_events")
          .select("id, title, start_at, end_at, location, status, source_id, schedule_sources(title)")
          .eq("org_id", orgId)
          .neq("status", "cancelled")
          .lte("start_at", end.toISOString())
          .gte("end_at", start.toISOString())
          .order("start_at", { ascending: true });

        if (scheduleError) {
          console.error("[unified-events] Failed to fetch schedule events:", scheduleError);
        } else if (scheduleData) {
          const normalized = scheduleData.map((event): UnifiedEvent => {
            // schedule_sources can be object or array depending on the join
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
          allEvents.push(...normalized);
        }
      } catch (error) {
        console.error("[unified-events] Error querying schedule_events:", error);
      }
    }

    // 3. Query calendar_events table
    // Use broad DB bounds then enforce exact overlap in code.
    if (sources.has("feeds")) {
      try {
        const { data: calendarData, error: calendarError } = await supabase
          .from("calendar_events")
          .select("id, title, start_at, end_at, all_day, location, feed_id, scope, user_id, calendar_feeds(provider, google_calendar_id)")
          .eq("organization_id", orgId)
          .or(`scope.eq.org,user_id.eq.${user.id}`)
          .lte("start_at", end.toISOString())
          .order("start_at", { ascending: true });

        if (calendarError) {
          console.error("[unified-events] Failed to fetch calendar events:", calendarError);
        } else if (calendarData) {
          const overlappingCalendar = calendarData.filter((event) => {
            const eventStart = new Date(event.start_at);
            const eventEnd = event.end_at ? new Date(event.end_at) : null;
            return eventStart <= end && (eventEnd ? eventEnd >= start : eventStart >= start);
          });
          const normalized = overlappingCalendar.map((event): UnifiedEvent => {
            const feed = Array.isArray(event.calendar_feeds)
              ? event.calendar_feeds[0]
              : event.calendar_feeds;
            const sourceName = feed?.provider === "google" ? "Google Calendar" : "Calendar Feed";

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
          allEvents.push(...normalized);
        }
      } catch (error) {
        console.error("[unified-events] Error querying calendar_events:", error);
      }
    }

    // 4. Query academic_schedules table and expand recurring patterns
    if (sources.has("classes")) {
      try {
        const { data: classesData, error: classesError } = await supabase
          .from("academic_schedules")
          .select("*")
          .eq("organization_id", orgId)
          .eq("user_id", user.id)
          .is("deleted_at", null);

        if (classesError) {
          console.error("[unified-events] Failed to fetch academic schedules:", classesError);
        } else if (classesData) {
          for (const schedule of classesData) {
            const expanded = expandAcademicSchedule(schedule, start, end);
            allEvents.push(...expanded);
          }
        }
      } catch (error) {
        console.error("[unified-events] Error querying academic_schedules:", error);
      }
    }

    // Sort all events by start time
    allEvents.sort((a, b) => {
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });

    const total = allEvents.length;
    const paginatedEvents = allEvents.slice(offset, offset + limit);
    const truncated = total > MAX_EVENTS;
    const hasMore = offset + paginatedEvents.length < total;

    return NextResponse.json(
      {
        events: paginatedEvents,
        meta: {
          count: paginatedEvents.length,
          total,
          page,
          limit,
          hasMore,
          truncated,
        },
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    console.error("[unified-events] Error fetching events:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to fetch events." },
      { status: 500 }
    );
  }
}
