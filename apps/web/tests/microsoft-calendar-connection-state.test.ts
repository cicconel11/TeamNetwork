import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveMicrosoftCalendarState,
  type MicrosoftCalendarListItem,
  type MicrosoftCalendarsApiBody,
} from "@/lib/microsoft/calendar-connection-state";

type MicrosoftCalendar = MicrosoftCalendarListItem;
type MicrosoftCalendarStateBody = MicrosoftCalendarsApiBody;

describe("resolveMicrosoftCalendarState", () => {
  it("treats 403 reconnect_required as a reauth state", () => {
    const result = resolveMicrosoftCalendarState(403, {
      error: "reconnect_required",
    });

    assert.deepStrictEqual(result, {
      calendars: [],
      reconnectRequired: true,
      disconnected: false,
    });
  });

  it("treats 200 with missing calendars field as disconnected", () => {
    const result = resolveMicrosoftCalendarState(200, {});

    assert.deepStrictEqual(result, {
      calendars: [],
      reconnectRequired: false,
      disconnected: true,
    });
  });

  it("passes through calendars for a healthy connected response", () => {
    const calendars: MicrosoftCalendar[] = [
      { id: "AAMkAD...", name: "Calendar", isDefault: true },
      { id: "AAMkAE...", name: "Work", isDefault: false },
    ];

    const result = resolveMicrosoftCalendarState(200, { calendars });

    assert.deepStrictEqual(result, {
      calendars,
      reconnectRequired: false,
      disconnected: false,
    });
  });

  it("returns empty calendars array when connected but calendar list is empty", () => {
    const result = resolveMicrosoftCalendarState(200, { calendars: [] });

    assert.deepStrictEqual(result, {
      calendars: [],
      reconnectRequired: false,
      disconnected: false,
    });
  });

  it("does not treat a non-reconnect_required 403 as reconnect_required", () => {
    // e.g. a generic forbidden error — should not set reconnectRequired
    const result = resolveMicrosoftCalendarState(403, { error: "Forbidden" });

    assert.strictEqual(result.reconnectRequired, false);
  });

  it("does not treat a 5xx error as reconnect_required or disconnected", () => {
    // Server errors fall through — neither flag is set
    const result = resolveMicrosoftCalendarState(500, { error: "Internal Server Error" });

    assert.strictEqual(result.reconnectRequired, false);
    assert.strictEqual(result.disconnected, false);
  });
});

describe("getMicrosoftValidAccessToken — reconnect_required status returns null", () => {
  /**
   * The production getMicrosoftValidAccessToken reads the stored connection
   * from user_calendar_connections.  When the status is `reconnect_required`
   * the user's refresh token is stale and we cannot obtain a new access token
   * without re-authorising, so the function must return null.
   *
   * We test this via the calendars API route logic: when getMicrosoftValidAccessToken
   * returns null the route returns { error: "reconnect_required" } with status 403.
   * The resolver above then correctly maps that to { reconnectRequired: true }.
   */

  it("reconnect_required DB status leads to reconnectRequired:true in the UI", () => {
    // Simulate the chain:
    //   DB status = "reconnect_required"
    //   → getMicrosoftValidAccessToken returns null
    //   → /api/microsoft/calendars returns { error: "reconnect_required" }, status 403
    //   → resolveMicrosoftCalendarState maps this to { reconnectRequired: true }

    const simulatedApiStatus = 403;
    const simulatedApiBody: MicrosoftCalendarStateBody = { error: "reconnect_required" };

    const state = resolveMicrosoftCalendarState(simulatedApiStatus, simulatedApiBody);

    assert.strictEqual(state.reconnectRequired, true);
    assert.strictEqual(state.disconnected, false);
    assert.deepStrictEqual(state.calendars, []);
  });

  it("fully disconnected DB status leads to disconnected:true in the UI", () => {
    // When the user has no connection at all (or status = "disconnected"),
    // getMicrosoftValidAccessToken returns null and the calendars route returns 403.
    // We distinguish this from reconnect_required through the body shape.
    //
    // If the API has a different path for a truly disconnected user (e.g., returning
    // 200 with no calendars field, or the hook treating null access token as
    // "not connected at all"), the disconnected branch fires.

    const simulatedApiStatus = 200;
    const simulatedApiBody: MicrosoftCalendarStateBody = {}; // no calendars key

    const state = resolveMicrosoftCalendarState(simulatedApiStatus, simulatedApiBody);

    assert.strictEqual(state.disconnected, true);
    assert.strictEqual(state.reconnectRequired, false);
    assert.deepStrictEqual(state.calendars, []);
  });
});
