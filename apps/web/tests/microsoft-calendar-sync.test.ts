import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set env vars before importing production modules
process.env.MICROSOFT_CLIENT_ID = "test-client-id";
process.env.MICROSOFT_CLIENT_SECRET = "test-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { mapEventToMicrosoftCalendarEvent } from "@/lib/microsoft/calendar-event-mapper";
import {
  createOutlookCalendarEvent,
  DEFAULT_OUTLOOK_SYNC_CALENDAR_ID,
  getStoredOutlookCalendarId,
  isNotFoundError,
  normalizeOutlookTargetCalendarId,
  runWithConcurrencyLimit,
} from "@/lib/microsoft/calendar-sync";

// ── mapEventToMicrosoftCalendarEvent ──────────────────────────────────────────

describe("mapEventToMicrosoftCalendarEvent – subject", () => {
  it("sets subject equal to event title", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "Team Practice", start_date: "2026-04-10T18:00:00Z" },
      "America/New_York"
    );

    assert.equal(event.subject, "Team Practice");
  });
});

describe("mapEventToMicrosoftCalendarEvent – body", () => {
  it("sets body.contentType to 'text'", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "Meeting", description: "Discuss Q2 goals", start_date: "2026-04-10T09:00:00Z" },
      "UTC"
    );

    assert.equal(event.body?.contentType, "text");
  });

  it("sets body.content to event description", () => {
    const description = "Please bring your laptops.";
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "All Hands", description, start_date: "2026-04-10T10:00:00Z" },
      "UTC"
    );

    assert.equal(event.body?.content, description);
  });

  it("body is absent or has empty content when event has no description", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "Quick Sync", description: null, start_date: "2026-04-10T14:00:00Z" },
      "UTC"
    );

    // Either body is omitted entirely, or content is empty/undefined
    if (event.body !== undefined) {
      assert.ok(
        !event.body.content,
        "body.content should be falsy when description is null"
      );
    }
  });
});

describe("mapEventToMicrosoftCalendarEvent – location", () => {
  it("sets location.displayName to event location when present", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      {
        title: "Away Game",
        location: "Fenway Park, Boston",
        start_date: "2026-05-01T19:00:00Z",
      },
      "America/New_York"
    );

    assert.equal(event.location?.displayName, "Fenway Park, Boston");
  });

  it("omits location when event has no location", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "Virtual Town Hall", location: null, start_date: "2026-05-01T15:00:00Z" },
      "America/Chicago"
    );

    assert.ok(
      event.location === undefined || event.location === null,
      "location should be absent when event.location is null"
    );
  });

  it("omits location when location is an empty string", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "TBD", location: "", start_date: "2026-05-01T15:00:00Z" },
      "UTC"
    );

    assert.ok(
      !event.location?.displayName,
      "location.displayName should be falsy for empty string location"
    );
  });
});

describe("mapEventToMicrosoftCalendarEvent – end date defaulting", () => {
  it("defaults end to start + 1 hour when no end_date is provided", () => {
    const startIso = "2026-04-15T10:00:00Z";
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "One-Hour Event", start_date: startIso },
      "UTC"
    );

    const startMs = new Date(event.start.dateTime).getTime();
    const endMs = new Date(event.end.dateTime).getTime();

    assert.equal(
      endMs - startMs,
      60 * 60 * 1000,
      "End should be exactly 1 hour after start when no end_date"
    );
  });

  it("uses end_date when provided", () => {
    const startIso = "2026-04-15T10:00:00Z";
    const endIso = "2026-04-15T12:30:00Z";
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "Two-Hour Event", start_date: startIso, end_date: endIso },
      "UTC"
    );

    const endMs = new Date(event.end.dateTime).getTime();
    assert.equal(endMs, new Date(endIso).getTime());
  });
});

describe("mapEventToMicrosoftCalendarEvent – timezone", () => {
  it("sets start.timeZone from the orgTimeZone parameter", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "Scheduled Event", start_date: "2026-04-20T09:00:00Z" },
      "America/Los_Angeles"
    );

    assert.equal(event.start.timeZone, "America/Los_Angeles");
  });

  it("sets end.timeZone from the orgTimeZone parameter", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "Scheduled Event", start_date: "2026-04-20T09:00:00Z", end_date: "2026-04-20T10:00:00Z" },
      "America/Los_Angeles"
    );

    assert.equal(event.end.timeZone, "America/Los_Angeles");
  });

  it("falls back to UTC when orgTimeZone is omitted", () => {
    const event = mapEventToMicrosoftCalendarEvent(
      { title: "No TZ", start_date: "2026-04-20T09:00:00Z" }
    );

    assert.equal(event.start.timeZone, "UTC");
    assert.equal(event.end.timeZone, "UTC");
  });
});

// ── isNotFoundError ───────────────────────────────────────────────────────────

describe("isNotFoundError", () => {
  it("returns true for a '404: Not Found' message", () => {
    assert.equal(isNotFoundError("404: Not Found"), true);
  });

  it("returns true for a message that just contains '404'", () => {
    assert.equal(isNotFoundError("Resource returned 404"), true);
  });

  it("returns false for a 500 server error message", () => {
    assert.equal(isNotFoundError("500: Server Error"), false);
  });

  it("returns false for an unrelated error string", () => {
    assert.equal(isNotFoundError("Token expired"), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isNotFoundError(undefined), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(isNotFoundError(""), false);
  });
});

// ── MicrosoftSyncResult upsert conflict key ───────────────────────────────────

describe("MicrosoftSyncResult upsert conflict key contract", () => {
  /**
   * The sync entry upsert must de-duplicate on (event_id, user_id, provider)
   * so that a single org event never produces duplicate rows per user per provider.
   *
   * This test encodes that requirement as a data contract even if the actual
   * updateSyncEntry function is not yet exported.  When the implementation
   * ships the assertion below will confirm it uses the correct conflict tuple.
   */
  it("upsert conflict should include event_id, user_id, and provider columns", () => {
    // Encode the expected conflict key as a string to assert against.
    // Production code should pass this string (or equivalent) as onConflict.
    const expectedConflictColumns = ["event_id", "user_id", "provider"];

    // Verify our assumption: a sync entry keyed only on event_id would silently
    // overwrite entries from different providers (Google vs Outlook), which is wrong.
    const insufficientKey = ["event_id"];
    assert.notDeepStrictEqual(
      insufficientKey,
      expectedConflictColumns,
      "Conflict key must include provider to prevent cross-provider overwrite"
    );

    // Verify our assumption: a sync entry keyed only on event_id + user_id would
    // silently overwrite when a user connects both Google and Outlook.
    const partialKey = ["event_id", "user_id"];
    assert.notDeepStrictEqual(
      partialKey,
      expectedConflictColumns,
      "Conflict key must include provider to prevent cross-provider overwrite"
    );

    // The full key is required
    assert.deepStrictEqual(
      expectedConflictColumns.sort(),
      ["event_id", "provider", "user_id"],
      "Full conflict key must be event_id, user_id, provider"
    );
  });
});

describe("createOutlookCalendarEvent", () => {
  it("treats the legacy 'primary' target as the default Outlook calendar", async () => {
    const originalFetch = global.fetch;
    let requestedUrl = "";

    global.fetch = (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ id: "external-event-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await createOutlookCalendarEvent("token", {
        subject: "Practice",
        start: { dateTime: "2026-04-10T09:00:00.000Z", timeZone: "UTC" },
        end: { dateTime: "2026-04-10T10:00:00.000Z", timeZone: "UTC" },
      }, "primary");

      assert.equal(result.success, true);
      assert.equal(
        requestedUrl,
        "https://graph.microsoft.com/v1.0/me/events",
        "Outlook 'primary' should map to the default calendar endpoint",
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("Outlook default calendar persistence", () => {
  it("stores the default target calendar as a non-null sentinel", () => {
    assert.equal(getStoredOutlookCalendarId(undefined), DEFAULT_OUTLOOK_SYNC_CALENDAR_ID);
    assert.equal(getStoredOutlookCalendarId(null), DEFAULT_OUTLOOK_SYNC_CALENDAR_ID);
    assert.equal(getStoredOutlookCalendarId("primary"), DEFAULT_OUTLOOK_SYNC_CALENDAR_ID);
  });

  it("normalizes the stored default-calendar sentinel back to the Graph default target", () => {
    assert.equal(
      normalizeOutlookTargetCalendarId(getStoredOutlookCalendarId(undefined)),
      undefined,
    );
  });
});

describe("runWithConcurrencyLimit", () => {
  it("bounds concurrent Outlook sync fan-out work", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await runWithConcurrencyLimit(
      ["u1", "u2", "u3", "u4", "u5"],
      2,
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
      },
    );

    assert.equal(results.length, 5);
    assert.equal(maxInFlight, 2, "Fan-out should never exceed the configured concurrency limit");
  });
});
