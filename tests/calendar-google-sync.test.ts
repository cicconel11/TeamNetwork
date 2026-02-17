import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchGoogleCalendarEvents,
  syncGoogleCalendarFeed,
} from "@/lib/calendar/googleSync";
import type { SyncWindow } from "@/lib/calendar/syncHelpers";

// ---------- helpers ----------

function makeGoogleEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    status: "confirmed",
    summary: "Team Meeting",
    description: "Weekly sync",
    location: "Room 101",
    start: { dateTime: "2026-03-01T10:00:00Z" },
    end: { dateTime: "2026-03-01T11:00:00Z" },
    ...overrides,
  };
}

function makeWindow(): SyncWindow {
  return {
    start: new Date("2026-02-01T00:00:00Z"),
    end: new Date("2026-04-01T23:59:59Z"),
  };
}

type GoogleApiPage = {
  items: Record<string, unknown>[];
  nextPageToken?: string;
};

function makeFetcher(pages: GoogleApiPage[]) {
  let callIndex = 0;
  return async () => {
    const page = pages[callIndex] ?? pages[pages.length - 1];
    callIndex++;
    return new Response(JSON.stringify(page), { status: 200 });
  };
}

function makeErrorFetcher(status: number, body: string) {
  return async () => new Response(body, { status });
}

// ---------- fetchGoogleCalendarEvents ----------

describe("fetchGoogleCalendarEvents", () => {
  const window = makeWindow();

  it("returns normalized CalendarEventInstance array", async () => {
    const fetcher = makeFetcher([{ items: [makeGoogleEvent()] }]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result.length, 1);
    assert.equal(result[0].title, "Team Meeting");
    assert.equal(result[0].description, "Weekly sync");
    assert.equal(result[0].location, "Room 101");
    assert.equal(result[0].startAt, "2026-03-01T10:00:00Z");
    assert.equal(result[0].endAt, "2026-03-01T11:00:00Z");
    assert.equal(result[0].allDay, false);
  });

  it("maps Google event fields correctly", async () => {
    const evt = makeGoogleEvent({
      id: "g-123",
      summary: "Practice",
      description: null,
      location: null,
    });
    const fetcher = makeFetcher([{ items: [evt] }]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result[0].externalUid, "g-123");
    assert.equal(result[0].title, "Practice");
    assert.equal(result[0].description, null);
    assert.equal(result[0].location, null);
  });

  it("handles recurring events (expanded instances with recurringEventId)", async () => {
    const instances = [
      makeGoogleEvent({
        id: "evt-r-1_20260301",
        recurringEventId: "evt-r-1",
        summary: "Standup",
        start: { dateTime: "2026-03-01T09:00:00Z" },
        end: { dateTime: "2026-03-01T09:15:00Z" },
      }),
      makeGoogleEvent({
        id: "evt-r-1_20260302",
        recurringEventId: "evt-r-1",
        summary: "Standup",
        start: { dateTime: "2026-03-02T09:00:00Z" },
        end: { dateTime: "2026-03-02T09:15:00Z" },
      }),
    ];
    const fetcher = makeFetcher([{ items: instances }]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result.length, 2);
    // instanceKey uses recurringEventId for recurring events
    assert.equal(result[0].instanceKey, "evt-r-1|2026-03-01T09:00:00Z");
    assert.equal(result[1].instanceKey, "evt-r-1|2026-03-02T09:00:00Z");
    // externalUid is the recurringEventId for recurring instances
    assert.equal(result[0].externalUid, "evt-r-1");
  });

  it("handles all-day events (date vs dateTime)", async () => {
    const evt = makeGoogleEvent({
      id: "allday-1",
      start: { date: "2026-03-05" },
      end: { date: "2026-03-06" },
    });
    const fetcher = makeFetcher([{ items: [evt] }]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result.length, 1);
    assert.equal(result[0].allDay, true);
    // Start should be the beginning of the day
    assert.ok(result[0].startAt.startsWith("2026-03-05"));
    assert.ok(result[0].endAt!.startsWith("2026-03-06"));
  });

  it("skips cancelled events", async () => {
    const items = [
      makeGoogleEvent({ id: "live-1" }),
      makeGoogleEvent({ id: "dead-1", status: "cancelled" }),
    ];
    const fetcher = makeFetcher([{ items }]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result.length, 1);
    assert.equal(result[0].externalUid, "live-1");
  });

  it("handles pagination via nextPageToken", async () => {
    const page1: GoogleApiPage = {
      items: [makeGoogleEvent({ id: "p1" })],
      nextPageToken: "token-2",
    };
    const page2: GoogleApiPage = {
      items: [makeGoogleEvent({ id: "p2", start: { dateTime: "2026-03-02T10:00:00Z" }, end: { dateTime: "2026-03-02T11:00:00Z" } })],
    };
    const fetcher = makeFetcher([page1, page2]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result.length, 2);
    const uids = result.map((r) => r.externalUid);
    assert.ok(uids.includes("p1"));
    assert.ok(uids.includes("p2"));
  });

  it("passes timeMin and timeMax in request URL", async () => {
    let capturedUrl = "";
    const fetcher = async (url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };
    await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.ok(capturedUrl.includes("timeMin="));
    assert.ok(capturedUrl.includes("timeMax="));
  });

  it("generates stable instanceKey: eventId|startDateTime for single events", async () => {
    const evt = makeGoogleEvent({ id: "single-1" });
    const fetcher = makeFetcher([{ items: [evt] }]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result[0].instanceKey, "single-1|2026-03-01T10:00:00Z");
  });

  it("returns empty array on API error", async () => {
    const fetcher = makeErrorFetcher(500, "Internal Server Error");

    await assert.rejects(
      () => fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher),
      (err: Error) => {
        assert.ok(err.message.includes("500"));
        return true;
      }
    );
  });

  it("handles events with missing optional fields", async () => {
    const evt = {
      id: "minimal-1",
      status: "confirmed",
      start: { dateTime: "2026-03-01T10:00:00Z" },
      end: { dateTime: "2026-03-01T11:00:00Z" },
    };
    const fetcher = makeFetcher([{ items: [evt] }]);
    const result = await fetchGoogleCalendarEvents("tok", "cal-1", window, fetcher);

    assert.equal(result.length, 1);
    assert.equal(result[0].title, null);
    assert.equal(result[0].description, null);
    assert.equal(result[0].location, null);
  });
});

// ---------- syncGoogleCalendarFeed ----------

describe("syncGoogleCalendarFeed", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const feedId = "feed-google-1";
  const orgId = "org-1";
  const userId = "user-1";
  const connectedUserId = "admin-1";

  function seedFeed(overrides: Record<string, unknown> = {}) {
    stub.seed("calendar_feeds", [{
      id: feedId,
      user_id: userId,
      provider: "google",
      feed_url: "google://team-cal@group.calendar.google.com",
      status: "active",
      last_synced_at: null,
      last_error: null,
      organization_id: orgId,
      scope: "org",
      connected_user_id: connectedUserId,
      google_calendar_id: "team-cal@group.calendar.google.com",
      ...overrides,
    }]);
  }

  function seedConnection(overrides: Record<string, unknown> = {}) {
    stub.seed("user_calendar_connections", [{
      id: "conn-1",
      user_id: connectedUserId,
      google_email: "admin@test.com",
      access_token_encrypted: "fake-enc-access",
      refresh_token_encrypted: "fake-enc-refresh",
      token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      status: "connected",
      target_calendar_id: "primary",
      last_sync_at: null,
      ...overrides,
    }]);
  }

  function seedAdminRole(overrides: Record<string, unknown> = {}) {
    stub.seed("user_organization_roles", [{
      user_id: connectedUserId,
      organization_id: orgId,
      role: "admin",
      status: "active",
      ...overrides,
    }]);
  }

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("upserts events from Google Calendar into calendar_events", async () => {
    seedFeed();
    seedConnection();
    seedAdminRole();

    const googleEvents = [
      makeGoogleEvent({ id: "g1" }),
      makeGoogleEvent({ id: "g2", summary: "Lunch", start: { dateTime: "2026-03-01T12:00:00Z" }, end: { dateTime: "2026-03-01T13:00:00Z" } }),
    ];
    const fetcher = makeFetcher([{ items: googleEvents }]);

    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];
    const result = await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        fetcher,
        getAccessToken: async () => "fake-token",
        checkAdminRole: async () => true,
        window: makeWindow(),
      }
    );

    assert.equal(result.status, "active");
    assert.equal(result.upserted, 2);

    const events = stub.getRows("calendar_events");
    assert.equal(events.length, 2);
  });

  it("updates feed status to active on success", async () => {
    seedFeed();
    seedConnection();
    seedAdminRole();

    const fetcher = makeFetcher([{ items: [makeGoogleEvent()] }]);
    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];

    await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        fetcher,
        getAccessToken: async () => "fake-token",
        checkAdminRole: async () => true,
        window: makeWindow(),
      }
    );

    const feeds = stub.getRows("calendar_feeds");
    assert.equal(feeds[0].status, "active");
    assert.ok(feeds[0].last_synced_at);
    assert.equal(feeds[0].last_error, null);
  });

  it("sets feed to error when access token is unavailable", async () => {
    seedFeed();

    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];
    const result = await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        fetcher: makeFetcher([{ items: [] }]),
        getAccessToken: async () => null,
        checkAdminRole: async () => true,
        window: makeWindow(),
      }
    );

    assert.equal(result.status, "error");
    assert.ok(result.lastError?.includes("access token"));

    const feeds = stub.getRows("calendar_feeds");
    assert.equal(feeds[0].status, "error");
  });

  it("sets feed to error when connected user loses admin role", async () => {
    seedFeed();
    seedConnection();
    seedAdminRole({ role: "active_member" }); // no longer admin

    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];
    const result = await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        fetcher: makeFetcher([{ items: [] }]),
        getAccessToken: async () => "fake-token",
        checkAdminRole: async () => false,
        window: makeWindow(),
      }
    );

    assert.equal(result.status, "error");
    assert.ok(result.lastError?.includes("admin"));

    const feeds = stub.getRows("calendar_feeds");
    assert.equal(feeds[0].status, "error");
  });

  it("deletes stale events not returned by Google API", async () => {
    seedFeed();
    seedConnection();
    seedAdminRole();

    const window = makeWindow();

    // Seed a pre-existing calendar event that won't be returned by Google
    stub.seed("calendar_events", [{
      id: "stale-evt-1",
      user_id: userId,
      feed_id: feedId,
      external_uid: "old-g1",
      instance_key: "old-g1|2026-03-01T10:00:00Z",
      title: "Old Event",
      start_at: "2026-03-01T10:00:00Z",
      end_at: "2026-03-01T11:00:00Z",
      all_day: false,
      organization_id: orgId,
      scope: "org",
    }]);

    // Google now returns a different event
    const fetcher = makeFetcher([{ items: [makeGoogleEvent({ id: "new-g1" })] }]);

    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];
    const result = await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        fetcher,
        getAccessToken: async () => "fake-token",
        checkAdminRole: async () => true,
        window,
      }
    );

    assert.equal(result.status, "active");
    assert.equal(result.deleted, 1);

    const events = stub.getRows("calendar_events");
    // Only the new event should remain
    assert.equal(events.length, 1);
    assert.equal(events[0].external_uid, "new-g1");
  });

  it("sets feed to error on API failure", async () => {
    seedFeed();
    seedConnection();
    seedAdminRole();

    const fetcher = makeErrorFetcher(500, "Server Error");
    const feed = stub.getRows("calendar_feeds")[0] as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"];

    const result = await syncGoogleCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        fetcher,
        getAccessToken: async () => "fake-token",
        checkAdminRole: async () => true,
        window: makeWindow(),
      }
    );

    assert.equal(result.status, "error");
    assert.ok(result.lastError);
  });
});
