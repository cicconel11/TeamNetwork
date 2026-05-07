import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "./utils/supabaseStub";
import {
  mapOutlookInstanceToScheduleEvent,
  outlookCalendarConnector,
} from "@/lib/schedule-connectors/outlookCalendar";
import type { CalendarEventInstance } from "@/lib/calendar/syncHelpers";
import { getConnectorById } from "@/lib/schedule-connectors/registry";

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
    raw: { microsoftEventId: "evt-1" },
    ...overrides,
  };
}

function makeGraphResponse() {
  return {
    value: [
      {
        id: "evt-1",
        subject: "Team Meeting",
        bodyPreview: "Weekly sync",
        location: { displayName: "Room 101" },
        start: { dateTime: "2026-03-01T10:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2026-03-01T11:00:00.0000000", timeZone: "UTC" },
      },
    ],
  };
}

describe("mapOutlookInstanceToScheduleEvent", () => {
  it("maps a CalendarEventInstance to a NormalizedEvent", () => {
    const instance = makeCalendarInstance();
    const result = mapOutlookInstanceToScheduleEvent(instance);

    assert.equal(result.external_uid, "evt-1|2026-03-01T10:00:00Z");
    assert.equal(result.title, "Team Meeting");
    assert.equal(result.start_at, "2026-03-01T10:00:00Z");
    assert.equal(result.end_at, "2026-03-01T11:00:00Z");
    assert.equal(result.location, "Room 101");
    assert.equal(result.status, "confirmed");
  });
});

describe("outlookCalendarConnector registration", () => {
  it("is available from the connector registry", () => {
    assert.equal(getConnectorById("outlook_calendar")?.id, "outlook_calendar");
  });
});

describe("outlookCalendarConnector", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  const orgId = "org-1";
  const userId = "user-1";
  const sourceId = "source-1";
  const calendarId = "AAMkADk-calendar-id";
  const url = `outlook://${calendarId}`;
  const window = {
    from: new Date("2026-02-01T00:00:00Z"),
    to: new Date("2026-04-01T23:59:59Z"),
  };

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("recognizes outlook:// URLs", async () => {
    const result = await outlookCalendarConnector.canHandle({ url });
    assert.equal(result.ok, true);
    assert.equal(result.confidence, 1);
  });

  it("fetches Outlook events for preview", async () => {
    const result = await outlookCalendarConnector.preview({
      url,
      orgId,
      userId,
      supabase: stub as unknown as SupabaseClient<Database>,
      fetcher: async () => new Response(JSON.stringify(makeGraphResponse()), { status: 200 }),
      getAccessToken: async () => "fake-token",
    });

    assert.equal(result.vendor, "outlook_calendar");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].title, "Team Meeting");
  });

  it("syncs Outlook events into schedule_events", async () => {
    const result = await outlookCalendarConnector.sync({
      sourceId,
      orgId,
      url,
      window,
      userId,
      supabase: stub as unknown as SupabaseClient<Database>,
      fetcher: async () => new Response(JSON.stringify(makeGraphResponse()), { status: 200 }),
      getAccessToken: async () => "fake-token",
    });

    assert.equal(result.vendor, "outlook_calendar");
    assert.equal(result.imported, 1);

    const rows = stub.getRows("schedule_events");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_id, sourceId);
    assert.equal(rows[0].title, "Team Meeting");
  });
});
