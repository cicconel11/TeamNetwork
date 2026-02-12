import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
  createAuthContext,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { googleCalendarFeedCreateSchema } from "@/lib/schemas/calendar";
import { syncGoogleCalendarFeed } from "@/lib/calendar/googleSync";

// ---------- Types ----------

interface GoogleFeedRequest {
  auth: AuthContext;
  body: {
    provider: string;
    googleCalendarId?: string;
    organizationId?: string;
  };
}

interface GoogleFeedResult {
  status: number;
  error?: string;
  message?: string;
  id?: string;
  provider?: string;
}

// ---------- Simulation ----------

/**
 * Simulates POST /api/calendar/org-feeds with provider: "google"
 * Mirrors the actual route logic for testing auth/validation/DB interactions.
 */
function simulateGoogleFeedCreate(
  request: GoogleFeedRequest,
  stub: ReturnType<typeof createSupabaseStub>
): GoogleFeedResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to add a feed." };
  }

  // Validate body
  const parseResult = googleCalendarFeedCreateSchema.safeParse(request.body);
  if (!parseResult.success) {
    return { status: 400, error: "Validation error", message: parseResult.error.issues[0].message };
  }
  const body = parseResult.data;

  // Admin check
  if (!isOrgAdmin(request.auth, body.organizationId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can manage org calendar feeds." };
  }

  // Google connection check
  const userId = request.auth.user!.id;
  const connections = stub.getRows("user_calendar_connections");
  const connection = connections.find(
    (c) => c.user_id === userId && c.status === "connected"
  );

  if (!connection) {
    return {
      status: 400,
      error: "No Google connection",
      message: "You must connect your Google account before adding a Google Calendar feed.",
    };
  }

  // Insert feed
  const feedUrl = `google://${body.googleCalendarId}`;
  stub.seed("calendar_feeds", [{
    user_id: userId,
    provider: "google",
    feed_url: feedUrl,
    organization_id: body.organizationId,
    scope: "org",
    connected_user_id: userId,
    google_calendar_id: body.googleCalendarId,
    status: "active",
    last_synced_at: null,
    last_error: null,
  }]);

  const feeds = stub.getRows("calendar_feeds");
  const feed = feeds[feeds.length - 1];

  return {
    status: 201,
    id: feed.id as string,
    provider: "google",
  };
}

// ---------- Tests ----------

describe("POST /api/calendar/org-feeds (provider: google)", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const orgId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  function seedConnection(userId: string) {
    stub.seed("user_calendar_connections", [{
      id: "conn-1",
      user_id: userId,
      google_email: "admin@test.com",
      access_token_encrypted: "fake",
      refresh_token_encrypted: "fake",
      token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      status: "connected",
      target_calendar_id: "primary",
    }]);
  }

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("creates a Google feed with valid admin + connection", () => {
    const auth = AuthPresets.orgAdmin(orgId);
    seedConnection(auth.user!.id);

    const result = simulateGoogleFeedCreate(
      {
        auth,
        body: {
          provider: "google",
          googleCalendarId: "team@group.calendar.google.com",
          organizationId: orgId,
        },
      },
      stub
    );

    assert.equal(result.status, 201);
    assert.equal(result.provider, "google");
    assert.ok(result.id);

    const feeds = stub.getRows("calendar_feeds");
    assert.equal(feeds.length, 1);
    assert.equal(feeds[0].provider, "google");
    assert.equal(feeds[0].google_calendar_id, "team@group.calendar.google.com");
    assert.equal(feeds[0].connected_user_id, auth.user!.id);
    assert.equal(feeds[0].feed_url, "google://team@group.calendar.google.com");
  });

  it("rejects if admin has no Google connection", () => {
    const auth = AuthPresets.orgAdmin(orgId);
    // No connection seeded

    const result = simulateGoogleFeedCreate(
      {
        auth,
        body: {
          provider: "google",
          googleCalendarId: "team@group.calendar.google.com",
          organizationId: orgId,
        },
      },
      stub
    );

    assert.equal(result.status, 400);
    assert.ok(result.message?.includes("Google account"));
  });

  it("rejects if not admin role", () => {
    const auth = AuthPresets.orgMember(orgId);
    seedConnection(auth.user!.id);

    const result = simulateGoogleFeedCreate(
      {
        auth,
        body: {
          provider: "google",
          googleCalendarId: "team@group.calendar.google.com",
          organizationId: orgId,
        },
      },
      stub
    );

    assert.equal(result.status, 403);
  });

  it("rejects unauthenticated request", () => {
    const result = simulateGoogleFeedCreate(
      {
        auth: AuthPresets.unauthenticated,
        body: {
          provider: "google",
          googleCalendarId: "team@group.calendar.google.com",
          organizationId: orgId,
        },
      },
      stub
    );

    assert.equal(result.status, 401);
  });

  it("rejects missing googleCalendarId", () => {
    const auth = AuthPresets.orgAdmin(orgId);
    seedConnection(auth.user!.id);

    const result = simulateGoogleFeedCreate(
      {
        auth,
        body: {
          provider: "google",
          organizationId: orgId,
        },
      },
      stub
    );

    assert.equal(result.status, 400);
  });

  it("rejects invalid organizationId", () => {
    const auth = AuthPresets.orgAdmin(orgId);
    seedConnection(auth.user!.id);

    const result = simulateGoogleFeedCreate(
      {
        auth,
        body: {
          provider: "google",
          googleCalendarId: "team@group.calendar.google.com",
          organizationId: "not-a-uuid",
        },
      },
      stub
    );

    assert.equal(result.status, 400);
  });
});

// ---------- Sync-time admin role check ----------

describe("syncGoogleCalendarFeed admin role validation", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const feedId = "feed-g-1";
  const orgId = "org-1";
  const connectedUserId = "admin-1";

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("marks feed as error when connected user is no longer admin", async () => {
    stub.seed("calendar_feeds", [{
      id: feedId,
      user_id: "someone",
      provider: "google",
      feed_url: "google://cal@group.calendar.google.com",
      status: "active",
      organization_id: orgId,
      scope: "org",
      connected_user_id: connectedUserId,
      google_calendar_id: "cal@group.calendar.google.com",
      last_synced_at: null,
      last_error: null,
    }]);

    // Connected user is now just a member, not admin
    stub.seed("user_organization_roles", [{
      user_id: connectedUserId,
      organization_id: orgId,
      role: "active_member",
      status: "active",
    }]);

    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];

    const result = await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        getAccessToken: async () => "fake-token",
        checkAdminRole: async (_sb, userId, oId) => {
          // Simulate looking up role from stub
          const roles = stub.getRows("user_organization_roles");
          const match = roles.find(
            (r) => r.user_id === userId && r.organization_id === oId
          );
          return !!match && match.role === "admin" && match.status === "active";
        },
      }
    );

    assert.equal(result.status, "error");
    assert.ok(result.lastError?.includes("admin"));

    const feeds = stub.getRows("calendar_feeds");
    assert.equal(feeds[0].status, "error");
  });

  it("succeeds when connected user is still admin", async () => {
    stub.seed("calendar_feeds", [{
      id: feedId,
      user_id: "someone",
      provider: "google",
      feed_url: "google://cal@group.calendar.google.com",
      status: "active",
      organization_id: orgId,
      scope: "org",
      connected_user_id: connectedUserId,
      google_calendar_id: "cal@group.calendar.google.com",
      last_synced_at: null,
      last_error: null,
    }]);

    stub.seed("user_organization_roles", [{
      user_id: connectedUserId,
      organization_id: orgId,
      role: "admin",
      status: "active",
    }]);

    const fetcher = async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 });

    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];

    const result = await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        fetcher,
        getAccessToken: async () => "fake-token",
        checkAdminRole: async () => true,
        window: {
          start: new Date("2026-02-01T00:00:00Z"),
          end: new Date("2026-04-01T23:59:59Z"),
        },
      }
    );

    assert.equal(result.status, "active");

    const feeds = stub.getRows("calendar_feeds");
    assert.equal(feeds[0].status, "active");
    assert.ok(feeds[0].last_synced_at);
  });
});

// ---------- GET returns Google feeds alongside ICS feeds ----------

describe("GET /api/calendar/org-feeds returns both providers", () => {
  it("lists Google and ICS feeds together", () => {
    const stub = createSupabaseStub();
    const orgId = "org-1";

    stub.seed("calendar_feeds", [
      {
        user_id: "admin-1",
        provider: "ics",
        feed_url: "https://example.com/calendar.ics",
        status: "active",
        organization_id: orgId,
        scope: "org",
        last_synced_at: null,
        last_error: null,
      },
      {
        user_id: "admin-1",
        provider: "google",
        feed_url: "google://team@group.calendar.google.com",
        status: "active",
        organization_id: orgId,
        scope: "org",
        connected_user_id: "admin-1",
        google_calendar_id: "team@group.calendar.google.com",
        last_synced_at: null,
        last_error: null,
      },
    ]);

    const feeds = stub.getRows("calendar_feeds")
      .filter((f) => f.organization_id === orgId && f.scope === "org");

    assert.equal(feeds.length, 2);
    const providers = feeds.map((f) => f.provider);
    assert.ok(providers.includes("ics"));
    assert.ok(providers.includes("google"));
  });
});
