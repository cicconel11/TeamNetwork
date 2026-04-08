import test from "node:test";
import assert from "node:assert";

// Set env vars before importing any module that might need them
process.env.MICROSOFT_CLIENT_ID = "test-client-id";
process.env.MICROSOFT_CLIENT_SECRET = "test-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { isUserEligibleForOutlookSync } from "@/lib/microsoft/calendar-sync";

/**
 * Tests for isUserEligibleForOutlookSync.
 *
 * Mirrors the comprehensive coverage for isUserEligibleForSync (Google)
 * but applied to the Outlook provider.  The function signature is expected
 * to match the Google equivalent:
 *
 *   isUserEligibleForOutlookSync(event, userId, connection, preferences, userRole)
 *
 * Where connection has a `status` field ("connected" | "disconnected" |
 * "reconnect_required" | "error" | null).
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function connected() {
  return { status: "connected" as const };
}

function disconnected() {
  return { status: "disconnected" as const };
}

function reconnectRequired() {
  return { status: "reconnect_required" as const };
}

function errorConnection() {
  return { status: "error" as const };
}

function allPrefsEnabled() {
  return {
    sync_general: true,
    sync_game: true,
    sync_meeting: true,
    sync_social: true,
    sync_fundraiser: true,
    sync_philanthropy: true,
    sync_practice: true,
    sync_workout: true,
  };
}

function prefsWithDisabled(type: string) {
  const prefs = allPrefsEnabled();
  (prefs as Record<string, boolean>)[`sync_${type}`] = false;
  return prefs;
}

// ── Connection Status ─────────────────────────────────────────────────────────

test("outlook: connected user with matching role is eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "all" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("outlook: disconnected user is not eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "all" },
    "user-1",
    disconnected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("outlook: reconnect_required status is not eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "all" },
    "user-1",
    reconnectRequired(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("outlook: error connection is not eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "all" },
    "user-1",
    errorConnection(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("outlook: null connection is not eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "all" },
    "user-1",
    null,
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

// ── Audience: "alumni" ────────────────────────────────────────────────────────

test("outlook: audience 'alumni' — member role is NOT eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "alumni" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("outlook: audience 'alumni' — alumni role is eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "alumni" },
    "user-1",
    connected(),
    null,
    "alumni"
  );
  assert.strictEqual(result, true);
});

// ── Audience: "members" ───────────────────────────────────────────────────────

test("outlook: audience 'members' — alumni role is NOT eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "members" },
    "user-1",
    connected(),
    null,
    "alumni"
  );
  assert.strictEqual(result, false);
});

test("outlook: audience 'members' — active_member is eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "members" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("outlook: audience 'members' — admin is eligible", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "members" },
    "user-1",
    connected(),
    null,
    "admin"
  );
  assert.strictEqual(result, true);
});

// ── Audience: "all" ───────────────────────────────────────────────────────────

test("outlook: audience 'all' — all roles are eligible when connected", () => {
  for (const role of ["admin", "active_member", "member", "alumni"] as const) {
    const result = isUserEligibleForOutlookSync(
      { audience: "all" },
      "user-1",
      connected(),
      null,
      role
    );
    assert.strictEqual(result, true, `role ${role} should be eligible for audience 'all'`);
  }
});

// ── Event Type Preferences ────────────────────────────────────────────────────

test("outlook: null preferences default to all types enabled", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "all", event_type: "practice" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("outlook: sync_practice:false makes user ineligible for practice events", () => {
  const result = isUserEligibleForOutlookSync(
    { audience: "all", event_type: "practice" },
    "user-1",
    connected(),
    prefsWithDisabled("practice"),
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("outlook: each event type respects its individual preference flag", () => {
  const types = [
    "general",
    "game",
    "meeting",
    "social",
    "fundraiser",
    "philanthropy",
    "practice",
    "workout",
  ] as const;

  for (const eventType of types) {
    // Enabled
    const enabledResult = isUserEligibleForOutlookSync(
      { audience: "all", event_type: eventType },
      "user-1",
      connected(),
      allPrefsEnabled(),
      "active_member"
    );
    assert.strictEqual(enabledResult, true, `${eventType} should be eligible when enabled`);

    // Disabled
    const disabledResult = isUserEligibleForOutlookSync(
      { audience: "all", event_type: eventType },
      "user-1",
      connected(),
      prefsWithDisabled(eventType),
      "active_member"
    );
    assert.strictEqual(disabledResult, false, `${eventType} should not be eligible when disabled`);
  }
});

// ── Dual-provider isolation ───────────────────────────────────────────────────

test("outlook: function only checks the connection status passed in (no implicit DB query)", () => {
  // The function must be pure with respect to its connection argument.
  // Passing a connected Outlook connection should return eligible
  // regardless of any hypothetical Google connection state.

  const outlookConnected = { status: "connected" as const, provider: "outlook" };
  const result = isUserEligibleForOutlookSync(
    { audience: "all" },
    "user-1",
    outlookConnected,
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("outlook: passing a disconnected connection returns false even if another provider is connected", () => {
  // Simulates a user who has Google connected but not Outlook.
  // The Outlook eligibility check should return false because the
  // passed-in connection is disconnected.
  const outlookDisconnected = { status: "disconnected" as const, provider: "outlook" };
  const result = isUserEligibleForOutlookSync(
    { audience: "all" },
    "user-1",
    outlookDisconnected,
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});
