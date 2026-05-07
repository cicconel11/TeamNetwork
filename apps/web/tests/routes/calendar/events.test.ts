import test from "node:test";
import assert from "node:assert";
import { eventOverlapsRange } from "@/lib/calendar/event-segments";
import {
  AuthContext,
  isAuthenticated,
  hasOrgMembership,
  AuthPresets,
  getOrgRole,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for calendar events routes:
 * - GET /api/calendar/events (list events for date range)
 * - GET /api/calendar/org-events (list org-wide events)
 */

// Types
interface EventsRequest {
  auth: AuthContext;
  organizationId?: string;
  start?: string;
  end?: string;
}

interface EventsResult {
  status: number;
  events?: Array<{
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    all_day: boolean;
    location: string | null;
    origin: "calendar" | "schedule" | "org";
  }>;
  meta?: {
    count: number;
    truncated: boolean;
    limit: number;
  };
  error?: string;
  message?: string;
}

interface EventsContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  calendarEvents?: Array<{
    id: string;
    title: string;
    start_at: string;
    end_at: string | null;
    all_day: boolean;
    location: string | null;
    user_id: string;
  }>;
  scheduleEvents?: Array<{
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    location: string | null;
    status: string;
  }>;
  orgEvents?: Array<{
    id: string;
    title: string;
    start_date: string;
    end_date: string | null;
    location: string | null;
    audience: string | null;
    target_user_ids: string[] | null;
  }>;
}

const MAX_EVENTS = 500;
const MAX_DATE_RANGE_DAYS = 365;
const CALENDAR_QUERY_BATCH_SIZE = 250;

function queryCalendarEventsForRange(
  events: NonNullable<EventsContext["calendarEvents"]>,
  userId: string | undefined,
  start: Date,
  end: Date,
) {
  const candidates = events
    .filter((event) => event.user_id === userId)
    .filter((event) => new Date(event.start_at) <= end)
    .filter((event) => event.end_at === null || new Date(event.end_at) >= start)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  const overlapping: Array<(typeof candidates)[number]> = [];

  for (let offset = 0; offset < candidates.length; offset += CALENDAR_QUERY_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + CALENDAR_QUERY_BATCH_SIZE);

    for (const event of batch) {
      if (!eventOverlapsRange({
        startAt: event.start_at,
        endAt: event.end_at,
        allDay: event.all_day,
      }, start, end)) {
        continue;
      }

      overlapping.push(event);
    }

    if (overlapping.length > MAX_EVENTS || batch.length < CALENDAR_QUERY_BATCH_SIZE) {
      break;
    }
  }

  return overlapping;
}

function simulateGetEvents(
  request: EventsRequest,
  ctx: EventsContext
): EventsResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to view events." };
  }

  if (!request.organizationId || !request.start || !request.end) {
    return { status: 400, error: "Missing parameters", message: "organizationId, start, and end are required." };
  }

  if (!hasOrgMembership(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden", message: "You are not a member of this organization." };
  }

  // Validate dates
  const start = new Date(request.start);
  const end = new Date(request.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { status: 400, error: "Invalid parameters", message: "start and end must be valid ISO dates." };
  }

  if (start > end) {
    return { status: 400, error: "Invalid parameters", message: "start must be before end." };
  }

  // Validate date range
  const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    return { status: 400, error: "Invalid parameters", message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.` };
  }

  const userId = request.auth.user?.id;
  const userRole = getOrgRole(request.auth, request.organizationId);

  const calendarEvents = queryCalendarEventsForRange(ctx.calendarEvents || [], userId, start, end)
    .map((e) => ({ ...e, origin: "calendar" as const }));

  // Include schedule events (org-wide)
  const scheduleEvents = (ctx.scheduleEvents || [])
    .filter((e) => e.status !== "cancelled")
    .filter((e) => new Date(e.start_at) <= end && new Date(e.end_at) >= start)
    .map((e) => ({
      id: `schedule:${e.id}`,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: false,
      location: e.location,
      origin: "schedule" as const,
    }));

  const orgEvents = (ctx.orgEvents || [])
    .filter((event) => new Date(event.start_date) <= end)
    .filter((event) => event.end_date === null || new Date(event.end_date) >= start)
    .filter((event) => {
      const targetUserIds = Array.isArray(event.target_user_ids) ? event.target_user_ids : [];
      if (targetUserIds.length > 0) {
        return targetUserIds.includes(userId || "");
      }

      switch (event.audience) {
        case "members":
          return userRole === "admin" || userRole === "active_member";
        case "alumni":
          return userRole === "alumni";
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
      end_at: event.end_date ?? event.start_date,
      all_day: false,
      location: event.location,
      origin: "org" as const,
    }));

  const combined = [...calendarEvents, ...scheduleEvents, ...orgEvents].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
  );

  const truncated = combined.length > MAX_EVENTS;
  const limitedEvents = combined.slice(0, MAX_EVENTS);

  return {
    status: 200,
    events: limitedEvents,
    meta: {
      count: limitedEvents.length,
      truncated,
      limit: MAX_EVENTS,
    },
  };
}

// Tests

test("GET events requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("GET events requires all parameters", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("organizationId, start, and end"));
});

test("GET events requires org membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.authenticatedNoOrg, organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("GET events validates date format", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "invalid", end: "2024-01-31" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("valid ISO dates"));
});

test("GET events validates start before end", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-02-01", end: "2024-01-01" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("start must be before end"));
});

test("GET events validates max date range", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2026-01-01" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("365 days"));
});

test("GET events returns calendar and schedule events", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    {
      supabase,
      calendarEvents: [
        { id: "cal-1", title: "Personal Meeting", start_at: "2024-01-15T10:00:00Z", end_at: "2024-01-15T11:00:00Z", all_day: false, location: "Office", user_id: "member-user" },
      ],
      scheduleEvents: [
        { id: "sch-1", title: "Team Practice", start_at: "2024-01-20T14:00:00Z", end_at: "2024-01-20T16:00:00Z", location: "Gym", status: "confirmed" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 2);
  assert.strictEqual(result.events?.[0].origin, "calendar");
  assert.strictEqual(result.events?.[1].origin, "schedule");
});

test("GET events includes org events with null end_date", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
      start: "2024-01-10T00:00:00Z",
      end: "2024-01-10T23:59:59Z",
    },
    {
      supabase,
      orgEvents: [
        {
          id: "org-1",
          title: "One-point org event",
          start_date: "2024-01-10T15:00:00Z",
          end_date: null,
          location: "Fieldhouse",
          audience: "both",
          target_user_ids: null,
        },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(
    result.events?.map((event) => ({ title: event.title, origin: event.origin })),
    [{ title: "One-point org event", origin: "org" }],
  );
});

test("GET events excludes org events outside the current user's audience or target list", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
      start: "2024-01-10T00:00:00Z",
      end: "2024-01-10T23:59:59Z",
    },
    {
      supabase,
      orgEvents: [
        {
          id: "org-alumni",
          title: "Alumni only",
          start_date: "2024-01-10T10:00:00Z",
          end_date: "2024-01-10T11:00:00Z",
          location: null,
          audience: "alumni",
          target_user_ids: null,
        },
        {
          id: "org-targeted",
          title: "Targeted away",
          start_date: "2024-01-10T12:00:00Z",
          end_date: "2024-01-10T13:00:00Z",
          location: null,
          audience: "both",
          target_user_ids: ["someone-else"],
        },
        {
          id: "org-member",
          title: "Member event",
          start_date: "2024-01-10T14:00:00Z",
          end_date: "2024-01-10T15:00:00Z",
          location: null,
          audience: "members",
          target_user_ids: null,
        },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(
    result.events?.map((event) => event.title),
    ["Member event"],
  );
});

test("GET events excludes cancelled schedule events", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    {
      supabase,
      scheduleEvents: [
        { id: "sch-1", title: "Active Event", start_at: "2024-01-15T10:00:00Z", end_at: "2024-01-15T11:00:00Z", location: null, status: "confirmed" },
        { id: "sch-2", title: "Cancelled Event", start_at: "2024-01-20T10:00:00Z", end_at: "2024-01-20T11:00:00Z", location: null, status: "cancelled" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].title, "Active Event");
});

test("GET events excludes other users' calendar events", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    {
      supabase,
      calendarEvents: [
        { id: "cal-1", title: "My Event", start_at: "2024-01-15T10:00:00Z", end_at: "2024-01-15T11:00:00Z", all_day: false, location: null, user_id: "member-user" },
        { id: "cal-2", title: "Other Event", start_at: "2024-01-20T10:00:00Z", end_at: "2024-01-20T11:00:00Z", all_day: false, location: null, user_id: "other-user" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].title, "My Event");
});

test("GET events sorts by start time", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    {
      supabase,
      calendarEvents: [
        { id: "cal-1", title: "Later Event", start_at: "2024-01-20T10:00:00Z", end_at: "2024-01-20T11:00:00Z", all_day: false, location: null, user_id: "member-user" },
      ],
      scheduleEvents: [
        { id: "sch-1", title: "Earlier Event", start_at: "2024-01-10T10:00:00Z", end_at: "2024-01-10T11:00:00Z", location: null, status: "confirmed" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.[0].title, "Earlier Event");
  assert.strictEqual(result.events?.[1].title, "Later Event");
});

test("GET events includes overlapping events that start before the requested range", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
      start: "2024-01-10T00:00:00Z",
      end: "2024-01-31T23:59:59Z",
    },
    {
      supabase,
      calendarEvents: [
        {
          id: "cal-overlap",
          title: "Overnight Trip",
          start_at: "2024-01-08T18:00:00Z",
          end_at: "2024-01-10T12:00:00Z",
          all_day: false,
          location: null,
          user_id: "member-user",
        },
      ],
      scheduleEvents: [
        {
          id: "sch-overlap",
          title: "Tournament",
          start_at: "2024-01-09T08:00:00Z",
          end_at: "2024-01-11T16:00:00Z",
          location: null,
          status: "confirmed",
        },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(
    result.events?.map((event) => event.title),
    ["Overnight Trip", "Tournament"],
  );
});

test("GET events includes null-end timed events that overlap via synthetic duration", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
      start: "2026-06-09T04:00:00Z",
      end: "2026-06-10T03:59:59Z",
    },
    {
      supabase,
      calendarEvents: [
        {
          id: "cal-null-end-overlap",
          title: "Late import",
          start_at: "2026-06-09T03:30:00Z",
          end_at: null,
          all_day: false,
          location: null,
          user_id: "member-user",
        },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(
    result.events?.map((event) => event.title),
    ["Late import"],
  );
});

test("GET events does not starve newer overlapping rows behind old null-end rows", () => {
  const supabase = createSupabaseStub();
  const oldNullEndRows = Array.from({ length: 501 }, (_, index) => ({
    id: `old-${index}`,
    title: `Old event ${index}`,
    start_at: `2023-01-${String((index % 28) + 1).padStart(2, "0")}T09:00:00Z`,
    end_at: null,
    all_day: false,
    location: null,
    user_id: "member-user",
  }));

  const result = simulateGetEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
      start: "2024-01-10T00:00:00Z",
      end: "2024-01-31T23:59:59Z",
    },
    {
      supabase,
      calendarEvents: [
        ...oldNullEndRows,
        {
          id: "current-overlap",
          title: "Current event",
          start_at: "2024-01-15T10:00:00Z",
          end_at: null,
          all_day: false,
          location: null,
          user_id: "member-user",
        },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(
    result.events?.map((event) => event.title),
    ["Current event"],
  );
});

test("GET events keeps imported null-end all-day rows visible on their local start day", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
      start: "2026-06-01T04:00:00Z",
      end: "2026-06-02T03:59:59Z",
    },
    {
      supabase,
      calendarEvents: [
        {
          id: "all-day-import",
          title: "Imported all day",
          start_at: "2026-06-01T00:00:00Z",
          end_at: null,
          all_day: true,
          location: null,
          user_id: "member-user",
        },
      ],
    },
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(
    result.events?.map((event) => event.title),
    ["Imported all day"],
  );
});

test("GET events does not let expired all-day exclusive-end rows consume the query window", () => {
  const supabase = createSupabaseStub();
  const expiredAllDayRows = Array.from({ length: 550 }, (_, index) => ({
    id: `expired-${index}`,
    title: `Expired all day ${index}`,
    start_at: "2026-05-01T00:00:00Z",
    end_at: "2026-06-01T04:00:00Z",
    all_day: true,
    location: null,
    user_id: "member-user",
  }));

  const result = simulateGetEvents(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
      start: "2026-06-01T04:00:00Z",
      end: "2026-06-02T03:59:59Z",
    },
    {
      supabase,
      calendarEvents: [
        ...expiredAllDayRows,
        {
          id: "in-range",
          title: "Visible all day",
          start_at: "2026-06-01T04:00:00Z",
          end_at: "2026-06-02T04:00:00Z",
          all_day: true,
          location: null,
          user_id: "member-user",
        },
      ],
    },
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(
    result.events?.map((event) => event.title),
    ["Visible all day"],
  );
});

test("GET events prefixes schedule event IDs", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    {
      supabase,
      scheduleEvents: [
        { id: "event-123", title: "Practice", start_at: "2024-01-15T10:00:00Z", end_at: "2024-01-15T11:00:00Z", location: null, status: "confirmed" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.[0].id, "schedule:event-123");
});

test("GET events includes truncated flag in meta", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    { supabase, calendarEvents: [] }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.meta?.truncated, false);
  assert.strictEqual(result.meta?.limit, 500);
});

test("GET events allows alumni to view events", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetEvents(
    { auth: AuthPresets.orgAlumni("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    { supabase }
  );
  assert.strictEqual(result.status, 200);
});
