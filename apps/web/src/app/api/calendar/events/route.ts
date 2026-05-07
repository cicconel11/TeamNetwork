import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { eventOverlapsRange } from "@/lib/calendar/event-segments";
import { getOrgMembership } from "@/lib/auth/api-helpers";

const MAX_EVENTS = 500;
const MAX_DATE_RANGE_DAYS = 365;
const CALENDAR_QUERY_BATCH_SIZE = 250;

export const dynamic = "force-dynamic";

type CalendarEventRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  location: string | null;
  feed_id: string | null;
  user_id: string;
};

async function fetchOverlappingCalendarEvents(
  supabase: SupabaseClient,
  userId: string,
  start: Date,
  end: Date,
): Promise<{ events: CalendarEventRow[]; error: unknown | null }> {
  const events: CalendarEventRow[] = [];

  for (let offset = 0; events.length <= MAX_EVENTS; offset += CALENDAR_QUERY_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("calendar_events")
      .select("id, title, start_at, end_at, all_day, location, feed_id, user_id")
      .eq("user_id", userId)
      .lte("start_at", end.toISOString())
      .or(`end_at.gte.${start.toISOString()},end_at.is.null`)
      .order("start_at", { ascending: true })
      .range(offset, offset + CALENDAR_QUERY_BATCH_SIZE - 1);

    if (error) {
      return { events: [], error };
    }

    const batch = (data || []) as CalendarEventRow[];
    for (const event of batch) {
      if (!eventOverlapsRange({
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: Boolean(event.all_day),
      }, start, end)) {
        continue;
      }

      events.push(event);
      if (events.length > MAX_EVENTS) {
        break;
      }
    }

    if (batch.length < CALENDAR_QUERY_BATCH_SIZE) {
      break;
    }
  }

  return { events, error: null };
}

export async function GET(request: Request) {
  // IP-based rate limiting (before auth to prevent unauthenticated abuse)
  const ipRateLimit = checkRateLimit(request, {
    limitPerIp: 30,
    limitPerUser: 0,
    windowMs: 60_000,
    feature: "calendar events",
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
      feature: "calendar events",
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    if (!organizationId || !startParam || !endParam) {
      return NextResponse.json(
        { error: "Missing parameters", message: "organizationId, start, and end are required." },
        { status: 400 }
      );
    }

    const membership = await getOrgMembership(supabase, user.id, organizationId);
    if (!membership) {
      return NextResponse.json(
        { error: "Forbidden", message: "Active membership required." },
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
        { status: 400, headers: rateLimit.headers }
      );
    }

    // Query all three event sources in parallel
    // Note: RLS policy only allows users to see their own calendar_events (auth.uid() = user_id)

    const [calendarResult, scheduleResult, orgResult] = await Promise.all([
      fetchOverlappingCalendarEvents(supabase, user.id, start, end),

      supabase
        .from("schedule_events")
        .select("id, title, start_at, end_at, location, status")
        .eq("org_id", organizationId)
        .neq("status", "cancelled")
        .lte("start_at", end.toISOString())
        .gte("end_at", start.toISOString())
        .limit(MAX_EVENTS + 1)
        .order("start_at", { ascending: true }),

      supabase
        .from("events")
        .select("id, title, start_date, end_date, location, event_type, organization_id, audience, target_user_ids")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .lte("start_date", end.toISOString())
        .or(`end_date.gte.${start.toISOString()},end_date.is.null`)
        .limit(MAX_EVENTS + 1)
        .order("start_date", { ascending: true }),
    ]);

    if (calendarResult.error) {
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch events." },
        { status: 500 }
      );
    }

    const events = calendarResult.events;

    if (scheduleResult.error) {
      console.error("[calendar-events] Failed to fetch schedule events:", scheduleResult.error);
    }
    const scheduleEvents = scheduleResult.data || [];

    if (orgResult.error) {
      console.error("[calendar-events] Failed to fetch org events:", orgResult.error);
    }
    const orgEvents = orgResult.data || [];

    const normalizedCalendar = events
      .map((event) => ({
        ...event,
        origin: "calendar" as const,
      }));

    const normalizedSchedule = scheduleEvents
      .filter((event) => eventOverlapsRange({
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: false,
      }, start, end))
      .map((event) => ({
        id: `schedule:${event.id}`,
        title: event.title,
        start_at: event.start_at,
        end_at: event.end_at,
        all_day: false,
        location: event.location,
        feed_id: null,
        user_id: `org:${organizationId}`,
        origin: "schedule" as const,
      }));

    const normalizedOrg = orgEvents
      .filter((event) => {
        const targetUserIds = Array.isArray(event.target_user_ids) ? event.target_user_ids : [];
        if (targetUserIds.length > 0) {
          return targetUserIds.includes(user.id);
        }

        switch (event.audience) {
          case "members":
            return membership.role === "admin" || membership.role === "active_member" || membership.role === "member";
          case "alumni":
            return membership.role === "alumni";
          case "all":
          case "both":
          case null:
            return true;
          default:
            return true;
        }
      })
      .filter((event) => eventOverlapsRange({
        startAt: event.start_date,
        endAt: event.end_date,
        allDay: false,
      }, start, end))
      .map((event) => ({
        id: `org:${event.id}`,
        title: event.title,
        start_at: event.start_date,
        end_at: event.end_date,
        all_day: false,
        location: event.location,
        feed_id: null,
        user_id: `org:${organizationId}`,
        origin: "org" as const,
      }));

    const combined = [...normalizedCalendar, ...normalizedSchedule, ...normalizedOrg].sort((a, b) => {
      return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
    });

    const truncated = combined.length > MAX_EVENTS;
    const limitedEvents = combined.slice(0, MAX_EVENTS);

    return NextResponse.json(
      {
        events: limitedEvents,
        meta: {
          count: limitedEvents.length,
          truncated,
          limit: MAX_EVENTS,
        },
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    console.error("[calendar-events] Error fetching events:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to fetch events." },
      { status: 500 }
    );
  }
}
