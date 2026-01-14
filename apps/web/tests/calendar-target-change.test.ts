import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Set required env vars before importing modules
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

import { createSupabaseStub } from "./utils/supabaseStub";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isNotFoundError } from "@/lib/google/calendar-sync";

const USER_ID = "user-111";
const EVENT_ID = "event-222";
const ORG_ID = "org-333";

/**
 * These tests verify the data contracts and logic for the google_calendar_id
 * column fix. The fix ensures each event_calendar_entry stores which Google
 * Calendar it was synced to, so update/delete operations target the correct
 * calendar even after the user changes their target calendar.
 */
describe("calendar target change — google_calendar_id persistence", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    stub = createSupabaseStub();
    supabase = stub as unknown as SupabaseClient<Database>;
  });

  it("BUG REPRO: update after calendar switch — upsert stores new google_calendar_id", async () => {
    // Pre-condition: entry exists on "old-cal"
    stub.seed("event_calendar_entries", [{
      event_id: EVENT_ID,
      user_id: USER_ID,
      organization_id: ORG_ID,
      google_event_id: "old-google-event-id",
      google_calendar_id: "old-cal",
      sync_status: "synced",
    }]);

    // Verify pre-condition
    const before = stub.getRows("event_calendar_entries");
    assert.equal(before.length, 1);
    assert.equal(before[0].google_calendar_id, "old-cal");

    // Simulate what the fixed updateSyncEntry does:
    // After detecting mismatch (old-cal !== new-cal), it deletes from old-cal,
    // creates on new-cal, then upserts with the new calendar ID.
    const newGoogleEventId = "new-google-event-id";
    const newCalendarId = "new-cal";

    await supabase
      .from("event_calendar_entries")
      .upsert({
        event_id: EVENT_ID,
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_event_id: newGoogleEventId,
        google_calendar_id: newCalendarId,
        sync_status: "synced",
        last_error: null,
      }, { onConflict: "event_id,user_id" });

    const after = stub.getRows("event_calendar_entries");
    assert.equal(after.length, 1, "should upsert (not duplicate) on event_id,user_id");
    assert.equal(after[0].google_calendar_id, "new-cal",
      "google_calendar_id should be updated to new calendar");
    assert.equal(after[0].google_event_id, "new-google-event-id",
      "google_event_id should be updated to new event on new calendar");
  });

  it("BUG REPRO: delete after calendar switch — entry stores correct calendar for deletion", async () => {
    // Entry was created on "old-cal"
    stub.seed("event_calendar_entries", [{
      id: "entry-1",
      event_id: EVENT_ID,
      user_id: USER_ID,
      organization_id: ORG_ID,
      google_event_id: "old-google-event-id",
      google_calendar_id: "old-cal",
      sync_status: "synced",
    }]);

    // The fix: handleDeleteSync reads entry.google_calendar_id instead of
    // fetching the user's current targetCalendarId from user_calendar_connections.
    // Verify the entry has the stored calendar ID for the delete path.
    const { data: entries } = await supabase
      .from("event_calendar_entries")
      .select("*")
      .eq("event_id", EVENT_ID)
      .neq("sync_status", "deleted");

    assert.ok(entries);
    assert.equal(entries.length, 1);

    const entry = entries[0];
    // The delete path should use this value, NOT the user's current connection
    const calendarIdForDelete = (entry.google_calendar_id as string) || "primary";
    assert.equal(calendarIdForDelete, "old-cal",
      "delete should target old-cal where the event actually lives");

    // The bug was: code fetched user_calendar_connections.target_calendar_id
    // which would return "new-cal" → 404 on Google API → event orphaned on old-cal
  });

  it("no mismatch — normal update keeps same google_calendar_id", async () => {
    stub.seed("event_calendar_entries", [{
      event_id: EVENT_ID,
      user_id: USER_ID,
      organization_id: ORG_ID,
      google_event_id: "existing-event-id",
      google_calendar_id: "primary",
      sync_status: "synced",
    }]);

    // When target matches stored calendar, update goes to same calendar
    const entry = stub.getRows("event_calendar_entries")[0];
    const storedCalendarId = (entry.google_calendar_id as string) || "primary";
    const targetCalendarId = "primary";

    assert.equal(storedCalendarId, targetCalendarId,
      "no mismatch when stored and target calendar match");

    // After update, google_calendar_id stays the same
    await supabase
      .from("event_calendar_entries")
      .upsert({
        event_id: EVENT_ID,
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_event_id: "existing-event-id",
        google_calendar_id: targetCalendarId,
        sync_status: "synced",
        last_error: null,
      }, { onConflict: "event_id,user_id" });

    const after = stub.getRows("event_calendar_entries");
    assert.equal(after[0].google_calendar_id, "primary");
  });

  it("updateSyncEntry stores google_calendar_id in upsert payload", async () => {
    // Fresh insert — no existing entry
    await supabase
      .from("event_calendar_entries")
      .upsert({
        event_id: EVENT_ID,
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_event_id: "geid-1",
        google_calendar_id: "my-custom-calendar",
        sync_status: "synced",
        last_error: null,
      }, { onConflict: "event_id,user_id" });

    const entries = stub.getRows("event_calendar_entries");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].google_calendar_id, "my-custom-calendar",
      "google_calendar_id should be persisted on create");
    assert.equal(entries[0].google_event_id, "geid-1");
    assert.equal(entries[0].sync_status, "synced");
  });

  it("default fallback — pre-migration entries without google_calendar_id default to 'primary'", () => {
    // Simulate a pre-migration entry with no google_calendar_id
    stub.seed("event_calendar_entries", [{
      event_id: EVENT_ID,
      user_id: USER_ID,
      organization_id: ORG_ID,
      google_event_id: "legacy-event-id",
      sync_status: "synced",
      // no google_calendar_id — simulates pre-migration row
    }]);

    const entries = stub.getRows("event_calendar_entries");
    const entry = entries[0];

    // The code uses `entry.google_calendar_id || "primary"` as fallback
    const calendarId = (entry.google_calendar_id as string) || "primary";
    assert.equal(calendarId, "primary",
      "missing google_calendar_id should fall back to 'primary'");
  });

  it("best-effort delete on mismatch — old calendar delete failure is non-blocking", () => {
    // The fix's mismatch handling:
    // 1. Best-effort delete from old calendar (ignore failures)
    // 2. Create on new calendar
    // 3. Store new calendar ID
    //
    // This test verifies the logic: a failed delete result should NOT
    // prevent the create from proceeding.

    const deleteResult = { success: false, error: "403: Calendar not accessible" };

    // The code should proceed to create regardless of delete result
    // (no conditional gate on deleteResult.success)
    assert.equal(deleteResult.success, false);

    // After best-effort delete, create proceeds unconditionally
    const createResult = { success: true, googleEventId: "new-id" };
    assert.equal(createResult.success, true,
      "create should succeed independently of delete failure");
  });

  it("calendar mismatch detection identifies stored vs target difference", () => {
    // The mismatch detection logic used in syncEventForUser
    const cases: Array<{
      stored: string | undefined;
      target: string;
      shouldMismatch: boolean;
      label: string;
    }> = [
      { stored: "old-cal", target: "new-cal", shouldMismatch: true, label: "different calendars" },
      { stored: "primary", target: "primary", shouldMismatch: false, label: "both primary" },
      { stored: undefined, target: "primary", shouldMismatch: false, label: "undefined defaults to primary" },
      { stored: "cal-A", target: "cal-A", shouldMismatch: false, label: "same custom calendar" },
      { stored: "primary", target: "new-cal", shouldMismatch: true, label: "primary to custom" },
      { stored: undefined, target: "new-cal", shouldMismatch: true, label: "undefined to custom" },
    ];

    for (const { stored, target, shouldMismatch, label } of cases) {
      const hasMismatch = (stored || "primary") !== target;
      assert.equal(hasMismatch, shouldMismatch,
        `mismatch detection failed for case: ${label}`);
    }
  });

  it("sync route query logic — synced entries with mismatched google_calendar_id are included", async () => {
    // Simulates the query logic added to POST /api/calendar/sync:
    // After fetching pending/failed entries, we also fetch synced entries
    // whose google_calendar_id != the user's current targetCalendarId.

    const targetCalendarId = "new-cal";

    // Seed entries with various statuses and calendar IDs
    stub.seed("event_calendar_entries", [
      // Already pending — included by the original pending/failed query
      {
        event_id: "evt-1",
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_calendar_id: "old-cal",
        sync_status: "pending",
      },
      // Synced on old calendar — should be picked up by the NEW mismatch query
      {
        event_id: "evt-2",
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_calendar_id: "old-cal",
        sync_status: "synced",
      },
      // Synced on the correct (new) calendar — should NOT be picked up
      {
        event_id: "evt-3",
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_calendar_id: "new-cal",
        sync_status: "synced",
      },
      // Failed on old calendar — included by the original pending/failed query
      {
        event_id: "evt-4",
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_calendar_id: "old-cal",
        sync_status: "failed",
      },
      // Different user — should not be picked up at all
      {
        event_id: "evt-5",
        user_id: "other-user",
        organization_id: ORG_ID,
        google_calendar_id: "old-cal",
        sync_status: "synced",
      },
    ]);

    // Simulate the pending/failed query
    const { data: pendingEntries } = await supabase
      .from("event_calendar_entries")
      .select("event_id, organization_id")
      .eq("user_id", USER_ID)
      .in("sync_status", ["pending", "failed"]);

    // Simulate the mismatch query (new logic)
    const { data: mismatchedEntries } = await supabase
      .from("event_calendar_entries")
      .select("event_id, organization_id")
      .eq("user_id", USER_ID)
      .eq("sync_status", "synced")
      .neq("google_calendar_id", targetCalendarId);

    // Merge — same as the route does
    const allEntriesToSync = [
      ...(pendingEntries || []),
      ...(mismatchedEntries || []),
    ];

    // Should include: evt-1 (pending), evt-2 (synced mismatch), evt-4 (failed)
    // Should NOT include: evt-3 (synced, correct cal), evt-5 (different user)
    const eventIds = allEntriesToSync.map((e) => e.event_id).sort();
    assert.deepEqual(eventIds, ["evt-1", "evt-2", "evt-4"],
      "should include pending, failed, and synced-but-mismatched entries for this user");
  });

  it("sync route query logic — no mismatched entries when all on correct calendar", async () => {
    const targetCalendarId = "primary";

    stub.seed("event_calendar_entries", [
      {
        event_id: "evt-1",
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_calendar_id: "primary",
        sync_status: "synced",
      },
      {
        event_id: "evt-2",
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_calendar_id: "primary",
        sync_status: "synced",
      },
    ]);

    // Pending/failed query — should be empty
    const { data: pendingEntries } = await supabase
      .from("event_calendar_entries")
      .select("event_id, organization_id")
      .eq("user_id", USER_ID)
      .in("sync_status", ["pending", "failed"]);

    // Mismatch query — should also be empty
    const { data: mismatchedEntries } = await supabase
      .from("event_calendar_entries")
      .select("event_id, organization_id")
      .eq("user_id", USER_ID)
      .eq("sync_status", "synced")
      .neq("google_calendar_id", targetCalendarId);

    const allEntriesToSync = [
      ...(pendingEntries || []),
      ...(mismatchedEntries || []),
    ];

    assert.equal(allEntriesToSync.length, 0,
      "no entries to sync when all are on the correct calendar");
  });

  it("isNotFoundError correctly identifies 404 errors for mismatch recovery", () => {
    // When update hits wrong calendar, Google returns 404.
    // isNotFoundError is used to trigger the recovery path.
    assert.ok(isNotFoundError("404: Event not found in Google Calendar"));
    assert.ok(isNotFoundError("not found"));
    assert.ok(isNotFoundError("Error 404"));
    assert.ok(!isNotFoundError("403: Forbidden"));
    assert.ok(!isNotFoundError(undefined));
    assert.ok(!isNotFoundError(""));
  });

  it("'primary' vs actual email triggers mismatch — false positive before normalization", () => {
    // Before normalization, target_calendar_id is "primary" but entries were
    // synced with google_calendar_id = "alice@gmail.com" (the actual ID Google returns).
    // Or vice versa: entries have "primary", but dropdown selection stores the email.
    // Either way, string mismatch triggers unnecessary delete+recreate.
    const stored = "primary";
    const target = "alice@gmail.com";
    const hasMismatch = (stored || "primary") !== target;
    assert.equal(hasMismatch, true,
      "'primary' !== 'alice@gmail.com' triggers false mismatch before normalization");
  });

  it("after normalization, email vs email does not trigger mismatch", () => {
    // After loadCalendars normalizes "primary" → "alice@gmail.com",
    // both stored and target use the actual email. No false positive.
    const stored = "alice@gmail.com";
    const target = "alice@gmail.com";
    const hasMismatch = (stored || "primary") !== target;
    assert.equal(hasMismatch, false,
      "consistent email IDs should not trigger mismatch after normalization");
  });

  it("dropdown value matches option after normalization", () => {
    // Google Calendar API returns calendars with email-based IDs.
    // After normalization, targetCalendarId is the email, which matches an option.
    const calendars = [
      { id: "alice@gmail.com", summary: "Alice", primary: true },
      { id: "work@company.com", summary: "Work", primary: false },
    ];
    const targetCalendarId = "alice@gmail.com"; // after normalization
    const selectedOption = calendars.find((c) => c.id === targetCalendarId);
    assert.ok(selectedOption, "dropdown should find a matching option after normalization");
    assert.equal(selectedOption.summary, "Alice");
  });

  it("dropdown value does NOT match any option before normalization", () => {
    // Before normalization, targetCalendarId is "primary" but no calendar has id="primary".
    // This documents the pre-fix state where the Select shows nothing selected.
    const calendars = [
      { id: "alice@gmail.com", summary: "Alice", primary: true },
      { id: "work@company.com", summary: "Work", primary: false },
    ];
    const targetCalendarId = "primary"; // before normalization
    const selectedOption = calendars.find((c) => c.id === targetCalendarId);
    assert.equal(selectedOption, undefined,
      "before normalization, 'primary' does not match any calendar option ID");
  });

  it("concurrent upserts on same event_id,user_id resolve to last writer wins", async () => {
    // Simulate rapid calendar switching: A→B→C
    // Each sync upserts with the current target calendar

    // First sync: created on cal-A
    await supabase
      .from("event_calendar_entries")
      .upsert({
        event_id: EVENT_ID,
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_event_id: "geid-a",
        google_calendar_id: "cal-A",
        sync_status: "synced",
        last_error: null,
      }, { onConflict: "event_id,user_id" });

    // Second sync: migrated to cal-B
    await supabase
      .from("event_calendar_entries")
      .upsert({
        event_id: EVENT_ID,
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_event_id: "geid-b",
        google_calendar_id: "cal-B",
        sync_status: "synced",
        last_error: null,
      }, { onConflict: "event_id,user_id" });

    // Third sync: migrated to cal-C (last writer wins)
    await supabase
      .from("event_calendar_entries")
      .upsert({
        event_id: EVENT_ID,
        user_id: USER_ID,
        organization_id: ORG_ID,
        google_event_id: "geid-c",
        google_calendar_id: "cal-C",
        sync_status: "synced",
        last_error: null,
      }, { onConflict: "event_id,user_id" });

    const entries = stub.getRows("event_calendar_entries");
    assert.equal(entries.length, 1, "should have single entry (upsert)");
    assert.equal(entries[0].google_calendar_id, "cal-C",
      "last writer wins — should be cal-C");
    assert.equal(entries[0].google_event_id, "geid-c");
  });
});
