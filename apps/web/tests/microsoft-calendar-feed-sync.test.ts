import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import { mapOutlookEvent, syncOutlookCalendarFeed } from "@/lib/calendar/outlookSync";
import type { CalendarFeedRow } from "@/lib/calendar/syncHelpers";

// ── Shared feed fixture ───────────────────────────────────────────────────────

const now = new Date().toISOString();

function makeFeed(overrides: Partial<CalendarFeedRow> = {}): CalendarFeedRow {
  return {
    id: "feed-uuid",
    user_id: "user-uuid",
    connected_user_id: "user-uuid",
    external_calendar_id: "AAMkAD...calendar-id",
    provider: "outlook",
    scope: "org",
    organization_id: "org-uuid",
    feed_url: "outlook://AAMkAD...calendar-id",
    status: "active",
    last_synced_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
    // Fields that may not exist yet (typed via the DB schema)
    google_calendar_id: null,
    ...overrides,
  } as CalendarFeedRow;
}

// ── Missing required fields ───────────────────────────────────────────────────

describe("syncOutlookCalendarFeed – missing connected_user_id", () => {
  it("returns error result when connected_user_id is null", async () => {
    const stub = createSupabaseStub();
    const feed = makeFeed({ connected_user_id: null });
    stub.seed("calendar_feeds", [feed]);

    const result = await syncOutlookCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed
    );

    assert.strictEqual(result.status, "error");
    assert.ok(
      result.lastError?.toLowerCase().includes("missing"),
      `Expected 'missing' in error message, got: "${result.lastError}"`
    );
  });
});

describe("syncOutlookCalendarFeed – missing external_calendar_id", () => {
  it("returns error result when external_calendar_id is null", async () => {
    const stub = createSupabaseStub();
    const feed = makeFeed({ external_calendar_id: null });
    stub.seed("calendar_feeds", [feed]);

    const result = await syncOutlookCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed
    );

    assert.strictEqual(result.status, "error");
    assert.ok(
      result.lastError?.toLowerCase().includes("missing"),
      `Expected 'missing' in error message, got: "${result.lastError}"`
    );
  });
});

// ── Access token unavailable ──────────────────────────────────────────────────

describe("syncOutlookCalendarFeed – access token unavailable", () => {
  it("returns error result when getAccessToken returns null", async () => {
    const stub = createSupabaseStub();
    const feed = makeFeed();
    stub.seed("calendar_feeds", [feed]);

    const result = await syncOutlookCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        // Inject a getAccessToken that always returns null
        getAccessToken: async () => null,
      }
    );

    assert.strictEqual(result.status, "error");
    assert.ok(
      result.lastError !== null && result.lastError !== undefined,
      "Should include an error message when access token is unavailable"
    );
  });
});

// ── Successful sync ───────────────────────────────────────────────────────────

describe("syncOutlookCalendarFeed – successful sync", () => {
  it("returns status:active with upserted count when Graph API responds correctly", async () => {
    const stub = createSupabaseStub();
    const feed = makeFeed();
    stub.seed("calendar_feeds", [feed]);

    // Build two fake Graph calendar events
    const eventStart = "2026-04-15T10:00:00.0000000";
    const eventEnd = "2026-04-15T11:00:00.0000000";
    const graphResponse = {
      value: [
        {
          id: "event-1",
          subject: "Morning Standup",
          bodyPreview: "Daily sync",
          start: { dateTime: eventStart, timeZone: "UTC" },
          end: { dateTime: eventEnd, timeZone: "UTC" },
        },
        {
          id: "event-2",
          subject: "Team Retrospective",
          bodyPreview: "",
          start: { dateTime: eventStart, timeZone: "UTC" },
          end: { dateTime: eventEnd, timeZone: "UTC" },
        },
      ],
      // No @odata.nextLink — single page
    };

    const mockFetcher = async (): Promise<Response> => {
      return new Response(JSON.stringify(graphResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await syncOutlookCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        getAccessToken: async () => "fake-access-token",
        checkAdminRole: async () => true,
        fetcher: mockFetcher as typeof fetch,
      }
    );

    assert.strictEqual(result.status, "active");
    assert.strictEqual(result.upserted, 2);
    assert.strictEqual(result.deleted, 0);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe("syncOutlookCalendarFeed – pagination via @odata.nextLink", () => {
  it("processes both pages when first response contains nextLink", async () => {
    const stub = createSupabaseStub();
    const feed = makeFeed();
    stub.seed("calendar_feeds", [feed]);

    const makeEvent = (id: string) => ({
      id,
      subject: `Event ${id}`,
      bodyPreview: "",
      start: { dateTime: "2026-05-01T09:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-05-01T10:00:00.0000000", timeZone: "UTC" },
    });

    const page1 = {
      value: [makeEvent("ev-1"), makeEvent("ev-2")],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/cal/events?$skip=2",
    };

    const page2 = {
      value: [makeEvent("ev-3")],
      // No nextLink — last page
    };

    let callCount = 0;
    const mockFetcher = async (url: string): Promise<Response> => {
      callCount++;
      const body = url.includes("$skip=2") ? page2 : page1;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await syncOutlookCalendarFeed(
      stub as unknown as SupabaseClient<Database>,
      feed,
      {
        getAccessToken: async () => "fake-access-token",
        checkAdminRole: async () => true,
        fetcher: mockFetcher as typeof fetch,
      }
    );

    assert.strictEqual(result.status, "active");
    // All 3 events across both pages must be processed
    assert.strictEqual(result.upserted, 3, "Should upsert events from both pages");
    assert.ok(callCount >= 2, "Should have made at least 2 fetch calls (one per page)");
  });
});

describe("mapOutlookEvent – Graph timezone handling", () => {
  it("interprets UTC floating timestamps using the Graph timeZone field", () => {
    const instance = mapOutlookEvent({
      id: "event-utc",
      subject: "UTC Event",
      start: { dateTime: "2026-05-01T09:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-05-01T10:00:00.0000000", timeZone: "UTC" },
    });

    assert.ok(instance, "Expected event instance to be created");
    assert.equal(instance?.startAt, "2026-05-01T09:00:00.000Z");
    assert.equal(instance?.endAt, "2026-05-01T10:00:00.000Z");
  });

  it("maps Microsoft timezone labels before converting to UTC", () => {
    const instance = mapOutlookEvent({
      id: "event-pst",
      subject: "Pacific Event",
      start: { dateTime: "2026-05-01T09:00:00.0000000", timeZone: "Pacific Standard Time" },
      end: { dateTime: "2026-05-01T10:30:00.0000000", timeZone: "Pacific Standard Time" },
    });

    assert.ok(instance, "Expected event instance to be created");
    assert.equal(instance?.startAt, "2026-05-01T16:00:00.000Z");
    assert.equal(instance?.endAt, "2026-05-01T17:30:00.000Z");
  });
});
