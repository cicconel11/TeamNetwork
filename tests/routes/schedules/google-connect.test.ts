import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for Google Calendar schedule source API routes:
 * - GET  /api/schedules/google/calendars — list user's Google calendars
 * - POST /api/schedules/google/connect  — connect a Google Calendar as schedule source
 */

// ---------- Types ----------

interface CalendarListRequest {
  auth: AuthContext;
  orgId?: string;
}

interface CalendarListResult {
  status: number;
  calendars?: Array<{ id: string; summary: string; primary?: boolean }>;
  error?: string;
  message?: string;
}

interface CalendarListContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  googleConnection?: {
    status: "connected" | "disconnected" | "error";
    googleEmail: string;
  };
  googleCalendars?: Array<{ id: string; summary: string; primary?: boolean }>;
}

interface GoogleConnectRequest {
  auth: AuthContext;
  orgId?: string;
  googleCalendarId?: string;
  title?: string;
}

interface GoogleConnectResult {
  status: number;
  source?: {
    id: string;
    vendor_id: string;
    status: string;
    title?: string | null;
  };
  error?: string;
  message?: string;
}

interface GoogleConnectContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  googleConnection?: {
    status: "connected" | "disconnected" | "error";
    googleEmail: string;
  };
  existingSource?: boolean;
  syncResult?: { imported: number; updated: number; cancelled: number };
}

// ---------- Simulation functions ----------

function simulateListCalendars(
  request: CalendarListRequest,
  ctx: CalendarListContext
): CalendarListResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in." };
  }

  if (!request.orgId) {
    return { status: 400, error: "Missing parameters", message: "orgId is required." };
  }

  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can manage schedule sources." };
  }

  if (!ctx.googleConnection || ctx.googleConnection.status !== "connected") {
    return { status: 404, error: "Not connected", message: "No Google account connected. Please connect your Google account first." };
  }

  if (!ctx.googleCalendars) {
    return { status: 500, error: "Google API error", message: "Failed to fetch calendar list from Google." };
  }

  return {
    status: 200,
    calendars: ctx.googleCalendars,
  };
}

function simulateGoogleConnect(
  request: GoogleConnectRequest,
  ctx: GoogleConnectContext
): GoogleConnectResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in." };
  }

  if (!request.orgId || !request.googleCalendarId) {
    return { status: 400, error: "Missing parameters", message: "orgId and googleCalendarId are required." };
  }

  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can connect schedule sources." };
  }

  if (!ctx.googleConnection || ctx.googleConnection.status !== "connected") {
    return { status: 400, error: "Not connected", message: "No Google account connected. Please connect your Google account first." };
  }

  if (ctx.existingSource) {
    return { status: 409, error: "Already connected", message: "This Google Calendar is already connected as a schedule source." };
  }

  return {
    status: 200,
    source: {
      id: "source-new-123",
      vendor_id: "google_calendar",
      status: "active",
      title: request.title ?? null,
    },
  };
}

// ---------- GET /api/schedules/google/calendars ----------

test("list calendars requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateListCalendars(
    { auth: AuthPresets.unauthenticated, orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("list calendars requires orgId", () => {
  const supabase = createSupabaseStub();
  const result = simulateListCalendars(
    { auth: AuthPresets.orgAdmin("org-1") },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("orgId"));
});

test("list calendars requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateListCalendars(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("list calendars returns 404 when no Google account connected", () => {
  const supabase = createSupabaseStub();
  const result = simulateListCalendars(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 404);
  assert.ok(result.message?.includes("Google account"));
});

test("list calendars returns 404 when Google account is disconnected", () => {
  const supabase = createSupabaseStub();
  const result = simulateListCalendars(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    { supabase, googleConnection: { status: "disconnected", googleEmail: "user@gmail.com" } }
  );
  assert.strictEqual(result.status, 404);
});

test("list calendars returns calendars on success", () => {
  const supabase = createSupabaseStub();
  const calendars = [
    { id: "primary", summary: "Main Calendar", primary: true },
    { id: "team-cal@group.calendar.google.com", summary: "Team Calendar" },
  ];
  const result = simulateListCalendars(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    {
      supabase,
      googleConnection: { status: "connected", googleEmail: "user@gmail.com" },
      googleCalendars: calendars,
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.calendars?.length, 2);
  assert.strictEqual(result.calendars?.[0].id, "primary");
  assert.strictEqual(result.calendars?.[1].summary, "Team Calendar");
});

// ---------- POST /api/schedules/google/connect ----------

test("google connect requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.unauthenticated, orgId: "org-1", googleCalendarId: "primary" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("google connect requires orgId and googleCalendarId", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("googleCalendarId"));
});

test("google connect requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", googleCalendarId: "primary" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("google connect rejects alumni", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.orgAlumni("org-1"), orgId: "org-1", googleCalendarId: "primary" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("google connect returns 400 when no Google account connected", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", googleCalendarId: "primary" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Google account"));
});

test("google connect returns 409 for duplicate source", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", googleCalendarId: "primary" },
    {
      supabase,
      googleConnection: { status: "connected", googleEmail: "user@gmail.com" },
      existingSource: true,
    }
  );
  assert.strictEqual(result.status, 409);
  assert.ok(result.message?.includes("already connected"));
});

test("google connect creates source on success", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", googleCalendarId: "team-cal@group.calendar.google.com", title: "Team Calendar" },
    {
      supabase,
      googleConnection: { status: "connected", googleEmail: "user@gmail.com" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.source?.vendor_id, "google_calendar");
  assert.strictEqual(result.source?.title, "Team Calendar");
});

test("google connect uses default title when none provided", () => {
  const supabase = createSupabaseStub();
  const result = simulateGoogleConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", googleCalendarId: "primary" },
    {
      supabase,
      googleConnection: { status: "connected", googleEmail: "user@gmail.com" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.source?.title, null);
});
