import test from "node:test";
import assert from "node:assert";
import { isUserEligibleForSync } from "@/lib/google/calendar-sync";

/**
 * Tests for isUserEligibleForSync — comprehensive coverage of calendar sync eligibility logic.
 */

// Helpers
function connected() {
  return { status: "connected" as const };
}

function disconnected() {
  return { status: "disconnected" as const };
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
  };
}

function prefsWithDisabled(disabled: string) {
  const prefs = allPrefsEnabled();
  (prefs as Record<string, boolean>)[`sync_${disabled}`] = false;
  return prefs;
}

// ── Connection Status ──

test("connected user is eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "all" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("disconnected user is not eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "all" },
    "user-1",
    disconnected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("error connection user is not eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "all" },
    "user-1",
    errorConnection(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("null connection is not eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "all" },
    "user-1",
    null,
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

// ── Audience: "members" ──

test("audience 'members' — active_member is eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "members" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("audience 'members' — admin is eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "members" },
    "user-1",
    connected(),
    null,
    "admin"
  );
  assert.strictEqual(result, true);
});

test("audience 'members' — member role is eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "members" },
    "user-1",
    connected(),
    null,
    "member"
  );
  assert.strictEqual(result, true);
});

test("audience 'members' — alumni is NOT eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "members" },
    "user-1",
    connected(),
    null,
    "alumni"
  );
  assert.strictEqual(result, false);
});

// ── Audience: "alumni" ──

test("audience 'alumni' — alumni is eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "alumni" },
    "user-1",
    connected(),
    null,
    "alumni"
  );
  assert.strictEqual(result, true);
});

test("audience 'alumni' — active_member is NOT eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "alumni" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("audience 'alumni' — admin is NOT eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "alumni" },
    "user-1",
    connected(),
    null,
    "admin"
  );
  assert.strictEqual(result, false);
});

// ── Audience: "all" / "both" ──

test("audience 'all' — all roles eligible", () => {
  for (const role of ["admin", "active_member", "member", "alumni"] as const) {
    const result = isUserEligibleForSync(
      { audience: "all" },
      "user-1",
      connected(),
      null,
      role
    );
    assert.strictEqual(result, true, `role ${role} should be eligible for audience 'all'`);
  }
});

test("audience 'both' — all roles eligible", () => {
  for (const role of ["admin", "active_member", "alumni"] as const) {
    const result = isUserEligibleForSync(
      { audience: "both" },
      "user-1",
      connected(),
      null,
      role
    );
    assert.strictEqual(result, true, `role ${role} should be eligible for audience 'both'`);
  }
});

// ── target_user_ids ──

test("target_user_ids set — listed user is eligible regardless of audience", () => {
  const result = isUserEligibleForSync(
    { audience: "alumni", target_user_ids: ["user-1", "user-2"] },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("target_user_ids set — unlisted user is NOT eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "all", target_user_ids: ["user-2", "user-3"] },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("empty target_user_ids falls through to audience check", () => {
  const result = isUserEligibleForSync(
    { audience: "alumni", target_user_ids: [] },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  // Empty array, so falls through to audience check — alumni only, active_member not eligible
  assert.strictEqual(result, false);
});

// ── Event Type Preferences ──

test("null preferences defaults to all types enabled", () => {
  const result = isUserEligibleForSync(
    { audience: "all", event_type: "game" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("disabled event type excludes user", () => {
  const result = isUserEligibleForSync(
    { audience: "all", event_type: "game" },
    "user-1",
    connected(),
    prefsWithDisabled("game"),
    "active_member"
  );
  assert.strictEqual(result, false);
});

test("enabled event type includes user", () => {
  const result = isUserEligibleForSync(
    { audience: "all", event_type: "game" },
    "user-1",
    connected(),
    allPrefsEnabled(),
    "active_member"
  );
  assert.strictEqual(result, true);
});

test("each event type respects its preference", () => {
  const types = ["general", "game", "meeting", "social", "fundraiser", "philanthropy"] as const;
  for (const eventType of types) {
    // Enabled
    const enabledResult = isUserEligibleForSync(
      { audience: "all", event_type: eventType },
      "user-1",
      connected(),
      allPrefsEnabled(),
      "active_member"
    );
    assert.strictEqual(enabledResult, true, `${eventType} should be eligible when enabled`);

    // Disabled
    const disabledResult = isUserEligibleForSync(
      { audience: "all", event_type: eventType },
      "user-1",
      connected(),
      prefsWithDisabled(eventType),
      "active_member"
    );
    assert.strictEqual(disabledResult, false, `${eventType} should not be eligible when disabled`);
  }
});

test("null event_type defaults to 'general'", () => {
  const result = isUserEligibleForSync(
    { audience: "all", event_type: null },
    "user-1",
    connected(),
    prefsWithDisabled("general"),
    "active_member"
  );
  assert.strictEqual(result, false);
});

// ── Unknown Audience ──

test("unknown audience defaults to eligible", () => {
  const result = isUserEligibleForSync(
    { audience: "custom_audience" },
    "user-1",
    connected(),
    null,
    "active_member"
  );
  assert.strictEqual(result, true);
});

// ── Null audience defaults to 'all' ──

test("null audience defaults to 'all'", () => {
  const result = isUserEligibleForSync(
    { audience: null },
    "user-1",
    connected(),
    null,
    "alumni"
  );
  assert.strictEqual(result, true);
});
