import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  isAuthenticated,
  hasOrgMembership,
  AuthPresets,
} from "../../utils/authMock.ts";

type SourceType = "events" | "schedules" | "feeds" | "classes";

interface UnifiedEvent {
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
}

interface UnifiedRequest {
  auth: AuthContext;
  orgId?: string;
  start?: string;
  end?: string;
  sources?: string;
  page?: number;
  limit?: number;
}

interface UnifiedResult {
  status: number;
  events?: UnifiedEvent[];
  meta?: {
    count: number;
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    truncated: boolean;
  };
  error?: string;
  message?: string;
}

interface MockEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  event_type: string | null;
  is_philanthropy: boolean;
  recurrence_group_id: string | null;
  deleted_at: string | null;
}

interface MockScheduleEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  status: string;
  source_title: string | null;
}

interface MockCalendarEvent {
  id: string;
  title: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  scope: string;
  user_id: string;
  provider: string;
}

interface MockAcademicSchedule {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string;
  end_time: string;
  occurrence_type: string;
  day_of_week: number[] | null;
  day_of_month: number | null;
  user_id: string;
  deleted_at: string | null;
}

interface UnifiedContext {
  events?: MockEvent[];
  scheduleEvents?: MockScheduleEvent[];
  calendarEvents?: MockCalendarEvent[];
  academicSchedules?: MockAcademicSchedule[];
}

const MAX_EVENTS = 2000;
const MAX_DATE_RANGE_DAYS = 400;

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function expandAcademicSchedule(
  schedule: MockAcademicSchedule,
  rangeStart: Date,
  rangeEnd: Date
): UnifiedEvent[] {
  const events: UnifiedEvent[] = [];
  const scheduleStart = parseLocalDate(schedule.start_date);
  const scheduleEnd = schedule.end_date ? parseLocalDate(schedule.end_date) : rangeEnd;
  const effectiveStart = new Date(Math.max(scheduleStart.getTime(), rangeStart.getTime()));
  const effectiveEnd = new Date(Math.min(scheduleEnd.getTime(), rangeEnd.getTime()));

  if (effectiveStart > effectiveEnd) return events;

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
      badges: ["class"],
    };
  };

  if (schedule.occurrence_type === "single") {
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

function parseSourcesParam(sources: string | undefined): Set<SourceType> {
  const all: SourceType[] = ["events", "schedules", "feeds", "classes"];
  if (!sources) return new Set(all);
  return new Set(
    sources.split(",").filter((s) => all.includes(s as SourceType)) as SourceType[]
  );
}

function simulateUnifiedEvents(request: UnifiedRequest, ctx: UnifiedContext): UnifiedResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in." };
  }
  if (!request.orgId || !request.start || !request.end) {
    return { status: 400, error: "Missing parameters", message: "orgId, start, and end are required." };
  }
  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Not a member of this organization." };
  }

  const start = new Date(request.start);
  const end = new Date(request.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { status: 400, error: "Invalid parameters", message: "Invalid dates." };
  }
  if (start > end) {
    return { status: 400, error: "Invalid parameters", message: "start must be before end." };
  }

  const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    return { status: 400, error: "Invalid parameters", message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.` };
  }

  const sources = parseSourcesParam(request.sources);
  const page = Math.max(1, request.page ?? 1);
  const limit = Math.min(MAX_EVENTS, Math.max(1, request.limit ?? MAX_EVENTS));
  const offset = (page - 1) * limit;
  const userId = request.auth.user?.id ?? "";

  const allEvents: UnifiedEvent[] = [];

  if (sources.has("events")) {
    const filtered = (ctx.events || [])
      .filter((e) => e.deleted_at === null)
      .filter((e) => {
        const s = new Date(e.start_date);
        const en = e.end_date ? new Date(e.end_date) : null;
        return s <= end && (en ? en >= start : s >= start);
      });

    filtered.forEach((event) => {
      const badges: string[] = [];
      if (event.event_type) badges.push(event.event_type);
      if (event.is_philanthropy) badges.push("philanthropy");
      if (event.recurrence_group_id) badges.push("recurring");
      allEvents.push({
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
      });
    });
  }

  if (sources.has("schedules")) {
    const filtered = (ctx.scheduleEvents || [])
      .filter((e) => e.status !== "cancelled")
      .filter((e) => new Date(e.start_at) <= end && new Date(e.end_at) >= start);

    filtered.forEach((event) => {
      allEvents.push({
        id: `schedule:${event.id}`,
        title: event.title,
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: false,
        location: event.location,
        sourceType: "schedule",
        sourceName: event.source_title || "Imported Schedule",
        badges: [],
      });
    });
  }

  if (sources.has("feeds")) {
    const filtered = (ctx.calendarEvents || [])
      .filter((e) => e.scope === "org" || e.user_id === userId)
      .filter((e) => {
        const s = new Date(e.start_at);
        const en = e.end_at ? new Date(e.end_at) : null;
        return s <= end && (en ? en >= start : s >= start);
      });

    filtered.forEach((event) => {
      allEvents.push({
        id: `feed:${event.id}`,
        title: event.title || "Untitled Event",
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: event.all_day,
        location: event.location,
        sourceType: "feed",
        sourceName: event.provider === "google" ? "Google Calendar" : "Calendar Feed",
        badges: [],
      });
    });
  }

  if (sources.has("classes")) {
    const schedules = (ctx.academicSchedules || []).filter(
      (s) => s.user_id === userId && s.deleted_at === null
    );
    schedules.forEach((schedule) => {
      allEvents.push(...expandAcademicSchedule(schedule, start, end));
    });
  }

  allEvents.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const paginatedEvents = allEvents.slice(offset, offset + limit);

  return {
    status: 200,
    events: paginatedEvents,
    meta: {
      count: paginatedEvents.length,
      total: allEvents.length,
      page,
      limit,
      hasMore: offset + paginatedEvents.length < allEvents.length,
      truncated: allEvents.length > MAX_EVENTS,
    },
  };
}

test("excludes null-end team event that starts before range", () => {
  const result = simulateUnifiedEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      orgId: "org-1",
      start: "2024-04-01T00:00:00Z",
      end: "2024-04-30T23:59:59Z",
      sources: "events",
    },
    {
      events: [
        {
          id: "ev-old",
          title: "Old no-end event",
          start_date: "2024-03-10T10:00:00Z",
          end_date: null,
          location: null,
          event_type: null,
          is_philanthropy: false,
          recurrence_group_id: null,
          deleted_at: null,
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 0);
});

test("includes null-end team event that starts inside range", () => {
  const result = simulateUnifiedEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      orgId: "org-1",
      start: "2024-04-01T00:00:00Z",
      end: "2024-04-30T23:59:59Z",
      sources: "events",
    },
    {
      events: [
        {
          id: "ev-in",
          title: "In-range no-end event",
          start_date: "2024-04-10T10:00:00Z",
          end_date: null,
          location: null,
          event_type: null,
          is_philanthropy: false,
          recurrence_group_id: null,
          deleted_at: null,
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
});

test("excludes null-end feed event that starts before range", () => {
  const result = simulateUnifiedEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      orgId: "org-1",
      start: "2024-04-01T00:00:00Z",
      end: "2024-04-30T23:59:59Z",
      sources: "feeds",
    },
    {
      calendarEvents: [
        {
          id: "cal-old",
          title: "Old no-end feed event",
          start_at: "2024-03-10T10:00:00Z",
          end_at: null,
          all_day: false,
          location: null,
          scope: "org",
          user_id: "other-user",
          provider: "ics",
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 0);
});

test("includes overlapping multi-day schedule event", () => {
  const result = simulateUnifiedEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      orgId: "org-1",
      start: "2024-04-01T00:00:00Z",
      end: "2024-04-30T23:59:59Z",
      sources: "schedules",
    },
    {
      scheduleEvents: [
        {
          id: "sch-1",
          title: "Overlap schedule",
          start_at: "2024-03-30T09:00:00Z",
          end_at: "2024-04-03T11:00:00Z",
          location: null,
          status: "confirmed",
          source_title: "Athletics",
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
});

test("single-occurrence class outside range is excluded", () => {
  const result = simulateUnifiedEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      orgId: "org-1",
      start: "2024-04-01T00:00:00Z",
      end: "2024-04-30T23:59:59Z",
      sources: "classes",
    },
    {
      academicSchedules: [
        {
          id: "single-past",
          title: "Past class",
          start_date: "2024-03-10",
          end_date: null,
          start_time: "09:00",
          end_time: "10:00",
          occurrence_type: "single",
          day_of_week: null,
          day_of_month: null,
          user_id: "member-user",
          deleted_at: null,
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 0);
});
