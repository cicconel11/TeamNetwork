import test from "node:test";
import assert from "node:assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  CALENDAR_FEED_SYNC_SELECT,
  isGoogleFeedProvider,
  syncFeedByProvider,
} from "@/lib/calendar/feedSync";

test("CALENDAR_FEED_SYNC_SELECT includes Google sync columns", () => {
  const columns = CALENDAR_FEED_SYNC_SELECT.split(",").map((value) => value.trim());
  assert.ok(columns.includes("connected_user_id"));
  assert.ok(columns.includes("google_calendar_id"));
});

test("isGoogleFeedProvider only matches google", () => {
  assert.strictEqual(isGoogleFeedProvider("google"), true);
  assert.strictEqual(isGoogleFeedProvider("ics"), false);
  assert.strictEqual(isGoogleFeedProvider(null), false);
  assert.strictEqual(isGoogleFeedProvider(undefined), false);
});

test("syncFeedByProvider uses Google sync path for google provider", async () => {
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
    connected_user_id: null,
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
  assert.ok(result.lastError?.includes("Missing connected_user_id or google_calendar_id"));
});
