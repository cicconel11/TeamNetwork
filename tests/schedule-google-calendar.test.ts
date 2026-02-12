import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  googleCalendarConnector,
  mapCalendarInstanceToScheduleEvent,
} from "@/lib/schedule-connectors/googleCalendar";
import type { CalendarEventInstance } from "@/lib/calendar/syncHelpers";
import type { NormalizedEvent } from "@/lib/schedule-connectors/types";

// ---------- helpers ----------

function makeCalendarInstance(overrides: Partial<CalendarEventInstance> = {}): CalendarEventInstance {
  return {
    externalUid: "evt-1",
    instanceKey: "evt-1|2026-03-01T10:00:00Z",
    title: "Team Meeting",
    description: "Weekly sync",
    location: "Room 101",
    startAt: "2026-03-01T10:00:00Z",
    endAt: "2026-03-01T11:00:00Z",
    allDay: false,
    raw: { googleEventId: "evt-1" },
    ...overrides,
  };
}

type GoogleApiPage = {
  items: Record<string, unknown>[];
  nextPageToken?: string;
};

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

function makeFetcher(pages: GoogleApiPage[]) {
  let callIndex = 0;
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const page = pages[callIndex] ?? pages[pages.length - 1];
    callIndex++;
    return new Response(JSON.stringify(page), { status: 200 });
  };
}

function makeErrorFetcher(status: number, body: string) {
  return async () => new Response(body, { status });
}

// ---------- mapCalendarInstanceToScheduleEvent ----------

describe("mapCalendarInstanceToScheduleEvent", () => {
  it("maps a CalendarEventInstance to a NormalizedEvent", () => {
    const instance = makeCalendarInstance();
    const result = mapCalendarInstanceToScheduleEvent(instance);

    assert.equal(result.external_uid, "evt-1|2026-03-01T10:00:00Z");
    assert.equal(result.title, "Team Meeting");
    assert.equal(result.start_at, "2026-03-01T10:00:00Z");
    assert.equal(result.end_at, "2026-03-01T11:00:00Z");
    assert.equal(result.location, "Room 101");
    assert.equal(result.status, "confirmed");
  });

  it("uses instanceKey as external_uid for dedup stability", () => {
    const instance = makeCalendarInstance({
      externalUid: "recurring-base",
      instanceKey: "recurring-base|2026-03-01T10:00:00Z",
    });
    const result = mapCalendarInstanceToScheduleEvent(instance);
    assert.equal(result.external_uid, "recurring-base|2026-03-01T10:00:00Z");
  });

  it("handles null title gracefully", () => {
    const instance = makeCalendarInstance({ title: null });
    const result = mapCalendarInstanceToScheduleEvent(instance);
    assert.equal(result.title, "");
  });

  it("handles null endAt", () => {
    const instance = makeCalendarInstance({ endAt: null });
    const result = mapCalendarInstanceToScheduleEvent(instance);
    // Should fall back — storage.ts ensureEndAt will handle it
    assert.equal(result.end_at, "");
  });

  it("handles null location", () => {
    const instance = makeCalendarInstance({ location: null });
    const result = mapCalendarInstanceToScheduleEvent(instance);
    assert.equal(result.location, undefined);
  });

  it("preserves raw data", () => {
    const instance = makeCalendarInstance({ raw: { googleEventId: "g-123", summary: "test" } });
    const result = mapCalendarInstanceToScheduleEvent(instance);
    assert.deepEqual(result.raw, { googleEventId: "g-123", summary: "test" });
  });
});

// ---------- canHandle ----------

describe("googleCalendarConnector.canHandle", () => {
  it("returns ok=true for google:// URLs with confidence 1.0", async () => {
    const result = await googleCalendarConnector.canHandle({
      url: "google://team-cal@group.calendar.google.com",
    });
    assert.equal(result.ok, true);
    assert.equal(result.confidence, 1.0);
  });

  it("returns ok=false for regular HTTP URLs", async () => {
    const result = await googleCalendarConnector.canHandle({
      url: "https://example.com/schedule",
    });
    assert.equal(result.ok, false);
    assert.equal(result.confidence, 0);
  });

  it("returns ok=false for ICS URLs", async () => {
    const result = await googleCalendarConnector.canHandle({
      url: "https://example.com/calendar.ics",
    });
    assert.equal(result.ok, false);
  });
});

// ---------- preview ----------

describe("googleCalendarConnector.preview", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const orgId = "org-1";
  const userId = "user-1";
  const calendarId = "team-cal@group.calendar.google.com";
  const url = `google://${calendarId}`;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("fetches events from Google and returns NormalizedEvent preview", async () => {
    const fetcher = makeFetcher([{
      items: [
        makeGoogleEvent({ id: "g1" }),
        makeGoogleEvent({
          id: "g2",
          summary: "Practice",
          start: { dateTime: "2026-03-02T14:00:00Z" },
          end: { dateTime: "2026-03-02T16:00:00Z" },
        }),
      ],
    }]);

    const result = await googleCalendarConnector.preview({
      url,
      orgId,
      userId,
      supabase: stub as unknown as SupabaseClient<Database>,
      fetcher,
      getAccessToken: async () => "fake-token",
    });

    assert.equal(result.vendor, "google_calendar");
    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].title, "Team Meeting");
    assert.equal(result.events[1].title, "Practice");
  });

  it("throws when no userId is provided", async () => {
    await assert.rejects(
      () => googleCalendarConnector.preview({
        url,
        orgId,
        supabase: stub as unknown as SupabaseClient<Database>,
        fetcher: makeFetcher([{ items: [] }]),
        getAccessToken: async () => "fake-token",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("userId"));
        return true;
      }
    );
  });

  it("throws when access token is unavailable", async () => {
    await assert.rejects(
      () => googleCalendarConnector.preview({
        url,
        orgId,
        userId,
        supabase: stub as unknown as SupabaseClient<Database>,
        fetcher: makeFetcher([{ items: [] }]),
        getAccessToken: async () => null,
      }),
      (err: Error) => {
        assert.ok(err.message.includes("access token"));
        return true;
      }
    );
  });

  it("throws on Google API error", async () => {
    await assert.rejects(
      () => googleCalendarConnector.preview({
        url,
        orgId,
        userId,
        supabase: stub as unknown as SupabaseClient<Database>,
        fetcher: makeErrorFetcher(401, "Unauthorized"),
        getAccessToken: async () => "expired-token",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("401"));
        return true;
      }
    );
  });
});

// ---------- sync ----------

describe("googleCalendarConnector.sync", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const orgId = "org-1";
  const sourceId = "src-1";
  const userId = "user-1";
  const calendarId = "team-cal@group.calendar.google.com";
  const url = `google://${calendarId}`;
  const window = {
    from: new Date("2026-02-01T00:00:00Z"),
    to: new Date("2026-04-01T23:59:59Z"),
  };

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("syncs Google Calendar events into schedule_events via syncScheduleEvents", async () => {
    const fetcher = makeFetcher([{
      items: [
        makeGoogleEvent({ id: "g1" }),
        makeGoogleEvent({
          id: "g2",
          summary: "Practice",
          start: { dateTime: "2026-03-02T14:00:00Z" },
          end: { dateTime: "2026-03-02T16:00:00Z" },
        }),
      ],
    }]);

    const result = await googleCalendarConnector.sync({
      sourceId,
      orgId,
      url,
      window,
      userId,
      supabase: stub as unknown as SupabaseClient<Database>,
      fetcher,
      getAccessToken: async () => "fake-token",
    });

    assert.equal(result.vendor, "google_calendar");
    assert.equal(result.imported, 2);
    assert.equal(result.cancelled, 0);

    const events = stub.getRows("schedule_events");
    assert.equal(events.length, 2);
  });

  it("cancels events that disappear from Google Calendar", async () => {
    // Seed existing event
    stub.seed("schedule_events", [{
      id: "existing-1",
      org_id: orgId,
      source_id: sourceId,
      external_uid: "old-event|2026-03-01T10:00:00Z",
      title: "Old Event",
      start_at: "2026-03-01T10:00:00Z",
      end_at: "2026-03-01T11:00:00Z",
      status: "confirmed",
      raw: {},
    }]);

    // Google now returns a different event
    const fetcher = makeFetcher([{
      items: [makeGoogleEvent({ id: "new-g1" })],
    }]);

    const result = await googleCalendarConnector.sync({
      sourceId,
      orgId,
      url,
      window,
      userId,
      supabase: stub as unknown as SupabaseClient<Database>,
      fetcher,
      getAccessToken: async () => "fake-token",
    });

    assert.equal(result.imported, 1);
    assert.equal(result.cancelled, 1);

    const events = stub.getRows("schedule_events");
    const cancelledEvent = events.find((e) => e.external_uid === "old-event|2026-03-01T10:00:00Z");
    assert.equal(cancelledEvent?.status, "cancelled");
  });

  it("handles recurring Google events correctly", async () => {
    const fetcher = makeFetcher([{
      items: [
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
      ],
    }]);

    const result = await googleCalendarConnector.sync({
      sourceId,
      orgId,
      url,
      window,
      userId,
      supabase: stub as unknown as SupabaseClient<Database>,
      fetcher,
      getAccessToken: async () => "fake-token",
    });

    assert.equal(result.imported, 2);

    const events = stub.getRows("schedule_events");
    assert.equal(events.length, 2);
    // Each recurring instance should have unique external_uid using instanceKey
    const uids = events.map((e) => e.external_uid);
    assert.notEqual(uids[0], uids[1]);
  });

  it("throws when userId is missing", async () => {
    await assert.rejects(
      () => googleCalendarConnector.sync({
        sourceId,
        orgId,
        url,
        window,
        supabase: stub as unknown as SupabaseClient<Database>,
        fetcher: makeFetcher([{ items: [] }]),
        getAccessToken: async () => "fake-token",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("userId"));
        return true;
      }
    );
  });

  it("throws when access token is unavailable", async () => {
    await assert.rejects(
      () => googleCalendarConnector.sync({
        sourceId,
        orgId,
        url,
        window,
        userId,
        supabase: stub as unknown as SupabaseClient<Database>,
        fetcher: makeFetcher([{ items: [] }]),
        getAccessToken: async () => null,
      }),
      (err: Error) => {
        assert.ok(err.message.includes("access token"));
        return true;
      }
    );
  });
});
