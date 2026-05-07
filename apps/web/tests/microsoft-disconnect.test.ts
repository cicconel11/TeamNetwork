import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { disconnectMicrosoft, encryptToken } from "@/lib/microsoft/oauth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

test("disconnectMicrosoft removes Outlook connection state without revoking Microsoft-wide sessions", async () => {
  const stub = createSupabaseStub();
  const supabase = stub as unknown as SupabaseClient<Database>;

  stub.seed("user_calendar_connections", [{
    id: "conn-1",
    user_id: "user-1",
    provider: "outlook",
    provider_email: "user@example.com",
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: "2026-05-01T12:00:00.000Z",
    status: "connected",
    target_calendar_id: null,
    last_sync_at: null,
  }]);
  stub.seed("event_calendar_entries", [
    {
      id: "entry-outlook",
      user_id: "user-1",
      provider: "outlook",
      event_id: "event-1",
    },
    {
      id: "entry-google",
      user_id: "user-1",
      provider: "google",
      event_id: "event-2",
    },
  ]);
  stub.seed("calendar_feeds", [
    {
      id: "feed-personal-outlook",
      connected_user_id: "user-1",
      provider: "outlook",
      scope: "personal",
    },
    {
      id: "feed-org-outlook",
      connected_user_id: "user-1",
      provider: "outlook",
      scope: "organization",
    },
  ]);
  stub.seed("schedule_sources", [
    {
      id: "source-outlook",
      connected_user_id: "user-1",
      vendor_id: "outlook_calendar",
      source_url: "outlook://calendar-1",
      org_id: "org-1",
      created_by: "user-1",
      external_calendar_id: "calendar-1",
    },
    {
      id: "source-google",
      connected_user_id: "user-1",
      vendor_id: "google_calendar",
      source_url: "google://calendar-2",
      org_id: "org-1",
      created_by: "user-1",
      external_calendar_id: "calendar-2",
    },
    {
      id: "source-outlook-other-user",
      connected_user_id: "user-2",
      vendor_id: "outlook_calendar",
      source_url: "outlook://calendar-3",
      org_id: "org-1",
      created_by: "user-2",
      external_calendar_id: "calendar-3",
    },
  ]);

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("disconnectMicrosoft should not call fetch");
  }) as typeof fetch;

  try {
    const result = await disconnectMicrosoft(supabase, "user-1");

    assert.equal(result.success, true);
    assert.equal(fetchCalls, 0, "Disconnect should not revoke Microsoft-wide sign-in sessions");

    assert.deepEqual(stub.getRows("user_calendar_connections"), []);
    assert.deepEqual(
      stub.getRows("event_calendar_entries").map((row) => row.id),
      ["entry-google"],
    );
    assert.deepEqual(
      stub.getRows("calendar_feeds").map((row) => row.id),
      ["feed-org-outlook"],
    );
    assert.deepEqual(
      stub.getRows("schedule_sources").map((row) => row.id).sort(),
      ["source-google", "source-outlook-other-user"],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("disconnectMicrosoft removes Outlook state even when stored tokens cannot be decrypted", async () => {
  const stub = createSupabaseStub();
  const supabase = stub as unknown as SupabaseClient<Database>;

  stub.seed("user_calendar_connections", [
    {
      id: "conn-outlook",
      user_id: "user-1",
      provider: "outlook",
      provider_email: "user@example.com",
      access_token_encrypted: "not-real-ciphertext",
      refresh_token_encrypted: "not-real-ciphertext",
      token_expires_at: "2026-05-01T12:00:00.000Z",
      status: "connected",
      target_calendar_id: null,
      last_sync_at: null,
    },
    {
      id: "conn-google",
      user_id: "user-1",
      provider: "google",
      provider_email: "user@example.com",
      access_token_encrypted: "google-ct",
      refresh_token_encrypted: "google-ct",
      token_expires_at: "2026-05-01T12:00:00.000Z",
      status: "connected",
      target_calendar_id: null,
      last_sync_at: null,
    },
  ]);
  stub.seed("event_calendar_entries", [
    { id: "entry-outlook", user_id: "user-1", provider: "outlook", event_id: "event-1" },
    { id: "entry-google", user_id: "user-1", provider: "google", event_id: "event-2" },
  ]);
  stub.seed("calendar_feeds", [
    { id: "feed-outlook", connected_user_id: "user-1", provider: "outlook", scope: "personal" },
    { id: "feed-google", connected_user_id: "user-1", provider: "google", scope: "personal" },
  ]);
  stub.seed("schedule_sources", [
    {
      id: "source-outlook",
      connected_user_id: "user-1",
      vendor_id: "outlook_calendar",
      source_url: "outlook://calendar-1",
      org_id: "org-1",
      created_by: "user-1",
      external_calendar_id: "calendar-1",
    },
    {
      id: "source-google",
      connected_user_id: "user-1",
      vendor_id: "google_calendar",
      source_url: "google://calendar-2",
      org_id: "org-1",
      created_by: "user-1",
      external_calendar_id: "calendar-2",
    },
  ]);

  const result = await disconnectMicrosoft(supabase, "user-1");

  assert.equal(result.success, true);

  assert.deepEqual(
    stub.getRows("user_calendar_connections").map((row) => row.id),
    ["conn-google"],
  );
  assert.deepEqual(
    stub.getRows("event_calendar_entries").map((row) => row.id),
    ["entry-google"],
  );
  assert.deepEqual(
    stub.getRows("calendar_feeds").map((row) => row.id),
    ["feed-google"],
  );
  assert.deepEqual(
    stub.getRows("schedule_sources").map((row) => row.id),
    ["source-google"],
  );
});
