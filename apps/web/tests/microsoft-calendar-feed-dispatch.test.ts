import test from "node:test";
import assert from "node:assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  CALENDAR_FEED_SYNC_SELECT,
  isGoogleFeedProvider,
  isOutlookFeedProvider,
  syncFeedByProvider,
} from "@/lib/calendar/feedSync";

// ── CALENDAR_FEED_SYNC_SELECT ─────────────────────────────────────────────────

test("CALENDAR_FEED_SYNC_SELECT includes Outlook sync columns", () => {
  const columns = CALENDAR_FEED_SYNC_SELECT.split(",").map((v) => v.trim());
  // connected_user_id identifies whose token to use
  assert.ok(columns.includes("connected_user_id"), "Should include connected_user_id");
  // external_calendar_id is the MS Graph calendar ID (replaces google_calendar_id for outlook)
  assert.ok(columns.includes("external_calendar_id"), "Should include external_calendar_id");
  // provider distinguishes ics / google / outlook
  assert.ok(columns.includes("provider"), "Should include provider");
});

// ── isOutlookFeedProvider ─────────────────────────────────────────────────────

test("isOutlookFeedProvider only matches 'outlook'", () => {
  assert.strictEqual(isOutlookFeedProvider("outlook"), true);
  assert.strictEqual(isOutlookFeedProvider("google"), false);
  assert.strictEqual(isOutlookFeedProvider("ics"), false);
  assert.strictEqual(isOutlookFeedProvider(null), false);
  assert.strictEqual(isOutlookFeedProvider(undefined), false);
});

test("isGoogleFeedProvider is not confused with outlook", () => {
  assert.strictEqual(isGoogleFeedProvider("outlook"), false);
});

// ── syncFeedByProvider – routing ──────────────────────────────────────────────

test("provider:'outlook' routes to syncOutlookCalendarFeed (not ICS, not Google)", async () => {
  const stub = createSupabaseStub();
  const now = new Date().toISOString();

  // An Outlook feed with a null connected_user_id so the sync short-circuits
  // with a specific "Missing" error — proving the Outlook path was taken
  // rather than the ICS fallback (which would fail for a different reason).
  const feed = {
    id: "feed-outlook-1",
    user_id: "user-1",
    provider: "outlook",
    feed_url: "outlook://AAMkAD...",
    organization_id: "org-1",
    scope: "org",
    status: "active",
    last_synced_at: null,
    last_error: null,
    connected_user_id: null,        // forces early-exit with "Missing" error
    external_calendar_id: null,
    google_calendar_id: null,
    created_at: now,
    updated_at: now,
  };

  stub.seed("calendar_feeds", [feed]);

  const result = await syncFeedByProvider(
    stub as unknown as SupabaseClient<Database>,
    feed as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"]
  );

  assert.strictEqual(result.status, "error");
  assert.ok(
    result.lastError?.toLowerCase().includes("missing"),
    `Expected Outlook path error 'missing ...', got: "${result.lastError}"`
  );
});

test("provider:'google' routes to syncGoogleCalendarFeed (not Outlook)", async () => {
  const stub = createSupabaseStub();
  const now = new Date().toISOString();

  const feed = {
    id: "feed-google-1",
    user_id: "user-1",
    provider: "google",
    feed_url: "google://primary",
    organization_id: "org-1",
    scope: "personal",
    status: "active",
    last_synced_at: null,
    last_error: null,
    connected_user_id: null,         // forces early-exit with Google-specific error
    external_calendar_id: null,
    google_calendar_id: null,
    created_at: now,
    updated_at: now,
  };

  stub.seed("calendar_feeds", [feed]);

  const result = await syncFeedByProvider(
    stub as unknown as SupabaseClient<Database>,
    feed as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"]
  );

  // Google path short-circuits with "Missing connected_user_id or external_calendar_id"
  // (the Google-specific column name used in googleSync.ts)
  assert.strictEqual(result.status, "error");
  assert.ok(
    result.lastError !== null && result.lastError !== undefined,
    "Should return an error message from the Google sync path"
  );
  // Crucially the error should NOT say "outlook" — this went through the Google path
  assert.ok(
    !result.lastError?.toLowerCase().includes("outlook"),
    "Google path error should not mention 'outlook'"
  );
});

test("provider:'ics' routes to ICS fallback (not Outlook, not Google)", async () => {
  const stub = createSupabaseStub();
  const now = new Date().toISOString();

  // ICS feed with a non-fetchable URL — the ICS sync will error on fetch,
  // producing an error that is distinct from the Outlook/Google early-exits.
  const feed = {
    id: "feed-ics-1",
    user_id: "user-1",
    provider: "ics",
    feed_url: "https://example.invalid/calendar.ics",
    organization_id: "org-1",
    scope: "org",
    status: "active",
    last_synced_at: null,
    last_error: null,
    connected_user_id: null,
    external_calendar_id: null,
    google_calendar_id: null,
    created_at: now,
    updated_at: now,
  };

  stub.seed("calendar_feeds", [feed]);

  const result = await syncFeedByProvider(
    stub as unknown as SupabaseClient<Database>,
    feed as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"]
  );

  // ICS sync will fail trying to fetch the URL — it should NOT produce the
  // Outlook "Missing connected_user_id" error (which would indicate wrong routing).
  assert.strictEqual(result.status, "error");
  assert.ok(
    !result.lastError?.toLowerCase().includes("missing connected_user_id"),
    "ICS route error should not say 'Missing connected_user_id' (that's the Outlook/Google error)"
  );
});

test("provider:null falls through to ICS fallback", async () => {
  const stub = createSupabaseStub();
  const now = new Date().toISOString();

  const feed = {
    id: "feed-null-1",
    user_id: "user-1",
    provider: null,
    feed_url: "https://example.invalid/cal.ics",
    organization_id: "org-1",
    scope: "personal",
    status: "active",
    last_synced_at: null,
    last_error: null,
    connected_user_id: null,
    external_calendar_id: null,
    google_calendar_id: null,
    created_at: now,
    updated_at: now,
  };

  stub.seed("calendar_feeds", [feed]);

  const result = await syncFeedByProvider(
    stub as unknown as SupabaseClient<Database>,
    feed as unknown as Database["public"]["Tables"]["calendar_feeds"]["Row"]
  );

  // Should error on the ICS fetch attempt, not on a missing token check
  assert.strictEqual(result.status, "error");
  assert.ok(
    !result.lastError?.toLowerCase().includes("missing connected_user_id"),
    "null provider should fall to ICS, not Outlook/Google path"
  );
});
