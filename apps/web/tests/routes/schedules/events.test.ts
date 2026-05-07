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
 * Tests for GET /api/schedules/events
 *
 * This route:
 * 1. Requires authentication
 * 2. Requires org membership
 * 3. Returns schedule events for the organization
 * 4. Supports date range filtering
 */

// Types
interface ScheduleEventsRequest {
  auth: AuthContext;
  orgId?: string;
  start?: string;
  end?: string;
}

interface ScheduleEventsResult {
  status: number;
  events?: Array<{
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    location: string | null;
    status: string;
    source_id: string;
  }>;
  meta?: {
    count: number;
    truncated: boolean;
  };
  error?: string;
  message?: string;
}

interface ScheduleEventsContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  events?: Array<{
    id: string;
    org_id: string;
    title: string;
    start_at: string;
    end_at: string;
    location: string | null;
    status: string;
    source_id: string;
  }>;
}

const MAX_EVENTS = 500;
const MAX_DATE_RANGE_DAYS = 400;

function simulateGetScheduleEvents(
  request: ScheduleEventsRequest,
  ctx: ScheduleEventsContext
): ScheduleEventsResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to view schedule events." };
  }

  if (!request.orgId) {
    return { status: 400, error: "Missing parameters", message: "orgId is required." };
  }

  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "You are not a member of this organization." };
  }

  // Optional date range filtering
  let start: Date | null = null;
  let end: Date | null = null;

  if (request.start && request.end) {
    start = new Date(request.start);
    end = new Date(request.end);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { status: 400, error: "Invalid parameters", message: "start and end must be valid ISO dates." };
    }

    if (start > end) {
      return { status: 400, error: "Invalid parameters", message: "start must be before end." };
    }

    const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (rangeDays > MAX_DATE_RANGE_DAYS) {
      return { status: 400, error: "Invalid parameters", message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.` };
    }
  }

  // Filter events
  let events = (ctx.events || [])
    .filter((e) => e.org_id === request.orgId)
    .filter((e) => e.status !== "cancelled");

  if (start && end) {
    events = events.filter((e) => {
      const eventStart = new Date(e.start_at);
      return eventStart >= start && eventStart <= end;
    });
  }

  // Sort by start time
  events = events.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  const truncated = events.length > MAX_EVENTS;
  const limitedEvents = events.slice(0, MAX_EVENTS).map((e) => ({
    id: e.id,
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at,
    location: e.location,
    status: e.status,
    source_id: e.source_id,
  }));

  return {
    status: 200,
    events: limitedEvents,
    meta: {
      count: limitedEvents.length,
      truncated,
    },
  };
}

// Tests

test("GET schedule events requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.unauthenticated, orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("GET schedule events requires orgId", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1") },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
});

test("GET schedule events requires org membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.authenticatedNoOrg, orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("GET schedule events returns org events", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    {
      supabase,
      events: [
        { id: "evt-1", org_id: "org-1", title: "Practice", start_at: "2024-01-15T14:00:00Z", end_at: "2024-01-15T16:00:00Z", location: "Gym", status: "confirmed", source_id: "src-1" },
        { id: "evt-2", org_id: "org-2", title: "Other Event", start_at: "2024-01-16T14:00:00Z", end_at: "2024-01-16T16:00:00Z", location: null, status: "confirmed", source_id: "src-2" }, // Different org
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].title, "Practice");
});

test("GET schedule events excludes cancelled events", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    {
      supabase,
      events: [
        { id: "evt-1", org_id: "org-1", title: "Active Event", start_at: "2024-01-15T14:00:00Z", end_at: "2024-01-15T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
        { id: "evt-2", org_id: "org-1", title: "Cancelled Event", start_at: "2024-01-16T14:00:00Z", end_at: "2024-01-16T16:00:00Z", location: null, status: "cancelled", source_id: "src-1" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].title, "Active Event");
});

test("GET schedule events filters by date range", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", start: "2024-01-10", end: "2024-01-20" },
    {
      supabase,
      events: [
        { id: "evt-1", org_id: "org-1", title: "Jan 5 Event", start_at: "2024-01-05T14:00:00Z", end_at: "2024-01-05T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
        { id: "evt-2", org_id: "org-1", title: "Jan 15 Event", start_at: "2024-01-15T14:00:00Z", end_at: "2024-01-15T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
        { id: "evt-3", org_id: "org-1", title: "Jan 25 Event", start_at: "2024-01-25T14:00:00Z", end_at: "2024-01-25T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].title, "Jan 15 Event");
});

test("GET schedule events validates date format", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", start: "invalid", end: "2024-01-20" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("valid ISO dates"));
});

test("GET schedule events validates start before end", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", start: "2024-02-01", end: "2024-01-01" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("start must be before end"));
});

test("GET schedule events validates max date range", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", start: "2024-01-01", end: "2026-06-01" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("400 days"));
});

test("GET schedule events sorts by start time", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    {
      supabase,
      events: [
        { id: "evt-1", org_id: "org-1", title: "Later", start_at: "2024-01-20T14:00:00Z", end_at: "2024-01-20T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
        { id: "evt-2", org_id: "org-1", title: "Earlier", start_at: "2024-01-10T14:00:00Z", end_at: "2024-01-10T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.[0].title, "Earlier");
  assert.strictEqual(result.events?.[1].title, "Later");
});

test("GET schedule events includes meta info", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    {
      supabase,
      events: [
        { id: "evt-1", org_id: "org-1", title: "Event", start_at: "2024-01-15T14:00:00Z", end_at: "2024-01-15T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.meta?.count, 1);
  assert.strictEqual(result.meta?.truncated, false);
});

test("GET schedule events allows alumni to view", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetScheduleEvents(
    { auth: AuthPresets.orgAlumni("org-1"), orgId: "org-1" },
    {
      supabase,
      events: [
        { id: "evt-1", org_id: "org-1", title: "Public Event", start_at: "2024-01-15T14:00:00Z", end_at: "2024-01-15T16:00:00Z", location: null, status: "confirmed", source_id: "src-1" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
});
