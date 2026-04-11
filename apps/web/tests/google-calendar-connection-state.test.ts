import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleCalendarConnectionState } from "@/lib/google/calendar-connection-state";

describe("resolveGoogleCalendarConnectionState", () => {
  it("treats connected:false as disconnected instead of reconnect required", () => {
    const result = resolveGoogleCalendarConnectionState(200, {
      calendars: [],
      connected: false,
    });

    assert.deepStrictEqual(result, {
      calendars: [],
      reconnectRequired: false,
      disconnected: true,
    });
  });

  it("treats reconnect_required as a reauth state", () => {
    const result = resolveGoogleCalendarConnectionState(403, {
      error: "reconnect_required",
    });

    assert.deepStrictEqual(result, {
      calendars: [],
      reconnectRequired: true,
      disconnected: false,
    });
  });

  it("passes through calendars for connected responses", () => {
    const result = resolveGoogleCalendarConnectionState(200, {
      calendars: [{ id: "primary", summary: "Main", primary: true }],
    });

    assert.deepStrictEqual(result, {
      calendars: [{ id: "primary", summary: "Main", primary: true }],
      reconnectRequired: false,
      disconnected: false,
    });
  });
});
