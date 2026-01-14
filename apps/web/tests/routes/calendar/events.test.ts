import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  hasOrgMembership,
  AuthPresets,
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
    origin: "calendar" | "schedule";
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
    end_at: string;
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
}

const MAX_EVENTS = 500;
const MAX_DATE_RANGE_DAYS = 365;

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

  // Filter calendar events for this user in the date range
  const calendarEvents = (ctx.calendarEvents || [])
    .filter((e) => e.user_id === userId)
    .filter((e) => new Date(e.start_at) >= start && new Date(e.start_at) <= end)
    .map((e) => ({ ...e, origin: "calendar" as const }));

  // Include schedule events (org-wide)
  const scheduleEvents = (ctx.scheduleEvents || [])
    .filter((e) => e.status !== "cancelled")
    .filter((e) => new Date(e.start_at) >= start && new Date(e.start_at) <= end)
    .map((e) => ({
      id: `schedule:${e.id}`,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: false,
      location: e.location,
      origin: "schedule" as const,
    }));

  const combined = [...calendarEvents, ...scheduleEvents].sort(
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
