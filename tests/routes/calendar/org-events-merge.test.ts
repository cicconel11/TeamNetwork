import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  isAuthenticated,
  hasOrgMembership,
  AuthPresets,
} from "../../utils/authMock.ts";

/**
 * Tests for the org-events API merge correctness.
 * Validates that events from both calendar_events and schedule_events merge,
 * sort, prefix, filter, and paginate correctly.
 */

interface OrgEventsRequest {
  auth: AuthContext;
  organizationId?: string;
  start?: string;
  end?: string;
  page?: number;
  limit?: number;
}

interface NormalizedEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  origin: "calendar" | "schedule";
}

interface OrgEventsResult {
  status: number;
  events?: NormalizedEvent[];
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

interface OrgEventsContext {
  calendarEvents?: Array<{
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    all_day: boolean;
    location: string | null;
    scope: string;
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

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
const MAX_DATE_RANGE_DAYS = 400;

function simulateOrgEvents(
  request: OrgEventsRequest,
  ctx: OrgEventsContext
): OrgEventsResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in." };
  }

  if (!request.organizationId || !request.start || !request.end) {
    return { status: 400, error: "Missing parameters", message: "organizationId, start, and end are required." };
  }

  if (!hasOrgMembership(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden", message: "Not a member of this organization." };
  }

  const start = new Date(request.start);
  const end = new Date(request.end);

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

  const page = Math.max(1, request.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, request.limit ?? DEFAULT_LIMIT));

  // Get org-scoped calendar events in date range
  const calEvents = (ctx.calendarEvents || [])
    .filter((e) => e.scope === "org")
    .filter((e) => new Date(e.start_at) >= start && new Date(e.start_at) <= end)
    .map((e) => ({
      id: e.id,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: e.all_day,
      location: e.location,
      origin: "calendar" as const,
    }));

  // Get non-cancelled schedule events in date range
  const schEvents = (ctx.scheduleEvents || [])
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

  // Merge and sort by start_at ascending
  const all = [...calEvents, ...schEvents].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
  );

  const total = all.length;
  const offset = (page - 1) * limit;
  const pageEvents = all.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return {
    status: 200,
    events: pageEvents,
    meta: {
      count: pageEvents.length,
      total,
      page,
      limit,
      hasMore,
      truncated: total > MAX_LIMIT,
    },
  };
}

// ── Tests ──

test("events from both sources appear in output", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-06-30" },
    {
      calendarEvents: [
        { id: "cal-1", title: "Calendar Event", start_at: "2024-03-15T10:00:00Z", end_at: "2024-03-15T11:00:00Z", all_day: false, location: "Room A", scope: "org" },
      ],
      scheduleEvents: [
        { id: "sch-1", title: "Schedule Event", start_at: "2024-04-10T14:00:00Z", end_at: "2024-04-10T16:00:00Z", location: "Field", status: "confirmed" },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 2);
  const origins = result.events?.map((e) => e.origin);
  assert.ok(origins?.includes("calendar"));
  assert.ok(origins?.includes("schedule"));
});

test("output sorted by start_at ascending regardless of source", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-12-31" },
    {
      calendarEvents: [
        { id: "cal-1", title: "Later Cal", start_at: "2024-06-15T10:00:00Z", end_at: "2024-06-15T11:00:00Z", all_day: false, location: null, scope: "org" },
      ],
      scheduleEvents: [
        { id: "sch-1", title: "Earlier Sch", start_at: "2024-03-01T09:00:00Z", end_at: "2024-03-01T10:00:00Z", location: null, status: "confirmed" },
        { id: "sch-2", title: "Middle Sch", start_at: "2024-05-01T09:00:00Z", end_at: "2024-05-01T10:00:00Z", location: null, status: "confirmed" },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 3);
  assert.strictEqual(result.events?.[0].title, "Earlier Sch");
  assert.strictEqual(result.events?.[1].title, "Middle Sch");
  assert.strictEqual(result.events?.[2].title, "Later Cal");
});

test("schedule event IDs prefixed with 'schedule:'", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-12-31" },
    {
      scheduleEvents: [
        { id: "abc-123", title: "Game Day", start_at: "2024-05-01T14:00:00Z", end_at: "2024-05-01T16:00:00Z", location: null, status: "confirmed" },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.[0].id, "schedule:abc-123");
});

test("cancelled schedule events are excluded", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-12-31" },
    {
      scheduleEvents: [
        { id: "sch-1", title: "Active", start_at: "2024-03-01T09:00:00Z", end_at: "2024-03-01T10:00:00Z", location: null, status: "confirmed" },
        { id: "sch-2", title: "Cancelled", start_at: "2024-04-01T09:00:00Z", end_at: "2024-04-01T10:00:00Z", location: null, status: "cancelled" },
        { id: "sch-3", title: "Tentative", start_at: "2024-05-01T09:00:00Z", end_at: "2024-05-01T10:00:00Z", location: null, status: "tentative" },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 2);
  const titles = result.events?.map((e) => e.title);
  assert.ok(!titles?.includes("Cancelled"));
  assert.ok(titles?.includes("Active"));
  assert.ok(titles?.includes("Tentative"));
});

test("non-org scope calendar events are excluded", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-12-31" },
    {
      calendarEvents: [
        { id: "cal-1", title: "Org Event", start_at: "2024-03-01T09:00:00Z", end_at: "2024-03-01T10:00:00Z", all_day: false, location: null, scope: "org" },
        { id: "cal-2", title: "Personal Event", start_at: "2024-04-01T09:00:00Z", end_at: "2024-04-01T10:00:00Z", all_day: false, location: null, scope: "personal" },
      ],
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].title, "Org Event");
});

test("pagination works correctly across merged sources", () => {
  const scheduleEvents = Array.from({ length: 5 }, (_, i) => ({
    id: `sch-${i}`,
    title: `Schedule ${i}`,
    start_at: `2024-0${i + 1}-15T10:00:00Z`,
    end_at: `2024-0${i + 1}-15T11:00:00Z`,
    location: null,
    status: "confirmed",
  }));

  const calendarEvents = Array.from({ length: 3 }, (_, i) => ({
    id: `cal-${i}`,
    title: `Calendar ${i}`,
    start_at: `2024-0${i + 2}-01T09:00:00Z`,
    end_at: `2024-0${i + 2}-01T10:00:00Z`,
    all_day: false,
    location: null,
    scope: "org",
  }));

  // Page 1 with limit 3
  const page1 = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-12-31", page: 1, limit: 3 },
    { calendarEvents, scheduleEvents }
  );

  assert.strictEqual(page1.status, 200);
  assert.strictEqual(page1.meta?.count, 3);
  assert.strictEqual(page1.meta?.total, 8);
  assert.strictEqual(page1.meta?.hasMore, true);
  assert.strictEqual(page1.meta?.page, 1);

  // Page 2 with limit 3
  const page2 = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-12-31", page: 2, limit: 3 },
    { calendarEvents, scheduleEvents }
  );

  assert.strictEqual(page2.status, 200);
  assert.strictEqual(page2.meta?.count, 3);
  assert.strictEqual(page2.meta?.hasMore, true);

  // Page 3 with limit 3 — should have remaining 2
  const page3 = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-12-31", page: 3, limit: 3 },
    { calendarEvents, scheduleEvents }
  );

  assert.strictEqual(page3.status, 200);
  assert.strictEqual(page3.meta?.count, 2);
  assert.strictEqual(page3.meta?.hasMore, false);

  // All events across pages should be unique
  const allEvents = [...(page1.events ?? []), ...(page2.events ?? []), ...(page3.events ?? [])];
  const ids = allEvents.map((e) => e.id);
  assert.strictEqual(new Set(ids).size, 8, "All event IDs should be unique across pages");
});

test("empty result returns valid structure", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2024-01-31" },
    { calendarEvents: [], scheduleEvents: [] }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.events?.length, 0);
  assert.strictEqual(result.meta?.count, 0);
  assert.strictEqual(result.meta?.total, 0);
  assert.strictEqual(result.meta?.hasMore, false);
});

test("date range exceeding limit returns 400", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", start: "2024-01-01", end: "2026-06-01" },
    {}
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("400 days"));
});

test("unauthenticated request returns 401", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1", start: "2024-01-01", end: "2024-12-31" },
    {}
  );

  assert.strictEqual(result.status, 401);
});

test("non-member returns 403", () => {
  const result = simulateOrgEvents(
    { auth: AuthPresets.authenticatedNoOrg, organizationId: "org-1", start: "2024-01-01", end: "2024-12-31" },
    {}
  );

  assert.strictEqual(result.status, 403);
});
