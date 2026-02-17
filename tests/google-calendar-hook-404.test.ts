import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for the 404-handling fix in useGoogleCalendarSync's loadCalendars.
 *
 * Since we can't render React hooks in Node's test runner, we extract and
 * test the core logic: when /api/google/calendars returns 404, the hook
 * should set reconnectRequired=true, clear calendars, and reload the
 * connection from the DB.
 */

// ---------------------------------------------------------------------------
// Helpers – simulate the state setters and loadConnection
// ---------------------------------------------------------------------------

interface StateCapture {
  calendarsLoading: boolean | null;
  reconnectRequired: boolean | null;
  calendars: unknown[] | null;
  loadConnectionCalled: boolean;
}

function createStateCapture(): StateCapture {
  return {
    calendarsLoading: null,
    reconnectRequired: null,
    calendars: null,
    loadConnectionCalled: false,
  };
}

/**
 * Mirrors the logic from loadCalendars in useGoogleCalendarSync.ts
 * (lines 136-181) so we can test it without React.
 */
async function simulateLoadCalendars(
  fetchResponse: { status: number; ok: boolean; json: () => Promise<unknown> },
  state: StateCapture,
) {
  state.calendarsLoading = true;
  state.reconnectRequired = false;
  try {
    const response = fetchResponse;

    if (response.status === 403) {
      const data = (await response.json()) as { error?: string };
      if (data.error === "reconnect_required") {
        state.reconnectRequired = true;
        state.calendars = [];
        return;
      }
    }

    // This is the NEW 404 handling being tested
    if (response.status === 404) {
      state.reconnectRequired = true;
      state.calendars = [];
      state.loadConnectionCalled = true; // simulates await loadConnection()
      return;
    }

    if (!response.ok) return;

    if (response.ok) {
      const data = (await response.json()) as { calendars?: unknown[] };
      state.calendars = data.calendars || [];
    }
  } catch {
    // Silently continue (matches hook behavior)
  } finally {
    state.calendarsLoading = false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useGoogleCalendarSync – loadCalendars 404 handling", () => {
  let state: StateCapture;

  beforeEach(() => {
    state = createStateCapture();
  });

  it("should set reconnectRequired and reload connection on 404", async () => {
    const response = {
      status: 404,
      ok: false,
      json: async () => ({ error: "not_found" }),
    };

    await simulateLoadCalendars(response, state);

    assert.equal(state.reconnectRequired, true, "reconnectRequired should be true");
    assert.deepEqual(state.calendars, [], "calendars should be cleared");
    assert.equal(state.loadConnectionCalled, true, "loadConnection should be called");
    assert.equal(state.calendarsLoading, false, "loading should finish");
  });

  it("should still handle 403 reconnect_required correctly", async () => {
    const response = {
      status: 403,
      ok: false,
      json: async () => ({ error: "reconnect_required" }),
    };

    await simulateLoadCalendars(response, state);

    assert.equal(state.reconnectRequired, true, "reconnectRequired should be true for 403");
    assert.deepEqual(state.calendars, [], "calendars should be cleared for 403");
    assert.equal(state.loadConnectionCalled, false, "loadConnection should NOT be called for 403");
    assert.equal(state.calendarsLoading, false, "loading should finish");
  });

  it("should populate calendars on 200 OK", async () => {
    const mockCalendars = [
      { id: "primary", summary: "Main", primary: true },
      { id: "work", summary: "Work", primary: false },
    ];
    const response = {
      status: 200,
      ok: true,
      json: async () => ({ calendars: mockCalendars }),
    };

    await simulateLoadCalendars(response, state);

    assert.equal(state.reconnectRequired, false, "reconnectRequired should be false on success");
    assert.deepEqual(state.calendars, mockCalendars, "calendars should be populated");
    assert.equal(state.loadConnectionCalled, false, "loadConnection should not be called on success");
    assert.equal(state.calendarsLoading, false, "loading should finish");
  });

  it("should handle non-reconnect 403 without setting reconnectRequired", async () => {
    const response = {
      status: 403,
      ok: false,
      json: async () => ({ error: "forbidden" }),
    };

    await simulateLoadCalendars(response, state);

    // 403 with a different error code falls through — no special handling
    assert.equal(state.reconnectRequired, false, "reconnectRequired should stay false for non-reconnect 403");
    assert.equal(state.calendars, null, "calendars should not be modified");
    assert.equal(state.calendarsLoading, false, "loading should finish");
  });

  it("should handle 500 server error gracefully (no crash)", async () => {
    const response = {
      status: 500,
      ok: false,
      json: async () => ({ error: "internal_server_error" }),
    };

    await simulateLoadCalendars(response, state);

    assert.equal(state.reconnectRequired, false, "reconnectRequired should stay false on 500");
    assert.equal(state.calendars, null, "calendars should not be modified on 500");
    assert.equal(state.calendarsLoading, false, "loading should finish");
  });
});

// ---------------------------------------------------------------------------
// Source code verification – ensure the actual hook file has the 404 fix
// ---------------------------------------------------------------------------

describe("useGoogleCalendarSync source verification", () => {
  it("should contain 404 handling in the hook source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const hookPath = path.join(
      process.cwd(),
      "src/hooks/useGoogleCalendarSync.ts",
    );
    const source = fs.readFileSync(hookPath, "utf-8");

    assert.ok(
      source.includes("response.status === 404"),
      "Hook should check for 404 status",
    );
    assert.ok(
      source.includes("setReconnectRequired(true)"),
      "Hook should set reconnectRequired on 404",
    );
    assert.ok(
      source.includes("await loadConnection()"),
      "Hook should call loadConnection on 404",
    );
  });

  it("should include loadConnection in loadCalendars dependency array", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const hookPath = path.join(
      process.cwd(),
      "src/hooks/useGoogleCalendarSync.ts",
    );
    const source = fs.readFileSync(hookPath, "utf-8");

    // Find the loadCalendars useCallback dependency array
    const loadCalendarsMatch = source.match(
      /const loadCalendars = useCallback\(async.*?\}, \[([^\]]+)\]\)/s,
    );
    assert.ok(loadCalendarsMatch, "Should find loadCalendars useCallback");
    assert.ok(
      loadCalendarsMatch[1].includes("loadConnection"),
      "loadCalendars deps should include loadConnection",
    );
  });
});
