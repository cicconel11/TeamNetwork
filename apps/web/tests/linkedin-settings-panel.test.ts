import test from "node:test";
import assert from "node:assert/strict";
import { getManualLinkedInSyncState } from "@/lib/linkedin/manual-sync-state";

test("manual LinkedIn sync state is visible and enabled for a valid saved URL with remaining quota", () => {
  const state = getManualLinkedInSyncState({
    linkedInUrl: "https://www.linkedin.com/in/jane-doe",
    brightDataConfigured: true,
    resyncEnabled: true,
    resyncIsAdmin: false,
    resyncRemaining: 2,
    resyncMaxPerMonth: 2,
  });

  assert.deepEqual(state, {
    visible: true,
    disabled: false,
    helperText: "2 of 2 syncs remaining",
  });
});

test("manual LinkedIn sync state stays visible but disabled when the org does not allow re-sync", () => {
  const state = getManualLinkedInSyncState({
    linkedInUrl: "https://www.linkedin.com/in/jane-doe",
    brightDataConfigured: true,
    resyncEnabled: false,
    resyncIsAdmin: false,
    resyncRemaining: 2,
    resyncMaxPerMonth: 2,
  });

  assert.deepEqual(state, {
    visible: true,
    disabled: true,
    helperText: "LinkedIn data re-sync is managed by your organization.",
  });
});

test("manual LinkedIn sync state is hidden when no valid saved LinkedIn URL exists", () => {
  const state = getManualLinkedInSyncState({
    linkedInUrl: "",
    brightDataConfigured: true,
    resyncEnabled: true,
    resyncIsAdmin: false,
    resyncRemaining: 2,
    resyncMaxPerMonth: 2,
  });

  assert.deepEqual(state, {
    visible: false,
    disabled: true,
    helperText: null,
  });
});

test("manual LinkedIn sync state disables the action when quota is exhausted", () => {
  const state = getManualLinkedInSyncState({
    linkedInUrl: "https://www.linkedin.com/in/jane-doe",
    brightDataConfigured: true,
    resyncEnabled: true,
    resyncIsAdmin: false,
    resyncRemaining: 0,
    resyncMaxPerMonth: 2,
  });

  assert.deepEqual(state, {
    visible: true,
    disabled: true,
    helperText: "Limit reached. Your LinkedIn sync quota resets next month.",
  });
});

test("manual LinkedIn sync state disables the action when Bright Data is unavailable", () => {
  const state = getManualLinkedInSyncState({
    linkedInUrl: "https://www.linkedin.com/in/jane-doe",
    brightDataConfigured: false,
    resyncEnabled: true,
    resyncIsAdmin: false,
    resyncRemaining: 1,
    resyncMaxPerMonth: 2,
  });

  assert.deepEqual(state, {
    visible: true,
    disabled: true,
    helperText: "Bright Data sync is not configured in this environment.",
  });
});
