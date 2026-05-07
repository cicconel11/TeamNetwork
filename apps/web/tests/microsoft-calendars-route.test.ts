import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { handleMicrosoftCalendarsGet } from "@/lib/microsoft/calendars";
import { encryptToken } from "@/lib/microsoft/oauth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function seedConnectedOutlookConnection(stub: ReturnType<typeof createSupabaseStub>, status = "connected") {
  stub.seed("user_calendar_connections", [{
    id: "conn-1",
    user_id: "user-1",
    provider: "outlook",
    provider_email: "user@example.com",
    access_token_encrypted: encryptToken("access-token"),
    refresh_token_encrypted: encryptToken("refresh-token"),
    token_expires_at: "2026-05-01T12:00:00.000Z",
    status,
    target_calendar_id: null,
    last_sync_at: null,
  }]);
}

test("handleMicrosoftCalendarsGet marks reconnect_required when Graph returns 401", async () => {
  const stub = createSupabaseStub();
  seedConnectedOutlookConnection(stub);

  const response = await handleMicrosoftCalendarsGet({
    supabase: stub as unknown as SupabaseClient<Database>,
    serviceSupabase: stub as unknown as SupabaseClient<Database>,
    userId: "user-1",
    getAccessToken: async () => "access-token",
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "InvalidAuthenticationToken" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "reconnect_required" });
  assert.equal(stub.getRows("user_calendar_connections")[0]?.status, "reconnect_required");
});

test("handleMicrosoftCalendarsGet marks reconnect_required when Graph returns 403", async () => {
  const stub = createSupabaseStub();
  seedConnectedOutlookConnection(stub);

  const response = await handleMicrosoftCalendarsGet({
    supabase: stub as unknown as SupabaseClient<Database>,
    serviceSupabase: stub as unknown as SupabaseClient<Database>,
    userId: "user-1",
    getAccessToken: async () => "access-token",
    fetchImpl: async () => new Response("Forbidden", { status: 403 }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "reconnect_required" });
  assert.equal(stub.getRows("user_calendar_connections")[0]?.status, "reconnect_required");
});

test("handleMicrosoftCalendarsGet preserves connected status for non-auth Graph failures", async () => {
  const stub = createSupabaseStub();
  seedConnectedOutlookConnection(stub);

  const response = await handleMicrosoftCalendarsGet({
    supabase: stub as unknown as SupabaseClient<Database>,
    serviceSupabase: stub as unknown as SupabaseClient<Database>,
    userId: "user-1",
    getAccessToken: async () => "access-token",
    fetchImpl: async () => new Response("Server error", { status: 500 }),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to list calendars" });
  assert.equal(stub.getRows("user_calendar_connections")[0]?.status, "connected");
});

function mixedGraphResponse() {
  return async () => new Response(JSON.stringify({
    value: [
      {
        id: "default-cal",
        name: "Calendar",
        isDefaultCalendar: true,
        canEdit: true,
        hexColor: "",
      },
      {
        id: "shared-readonly",
        name: "Shared Team Calendar",
        isDefaultCalendar: false,
        canEdit: false,
        hexColor: "#AABBCC",
      },
    ],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("handleMicrosoftCalendarsGet team_import mode returns readable calendars, including read-only team calendars", async () => {
  const stub = createSupabaseStub();

  const response = await handleMicrosoftCalendarsGet({
    supabase: stub as unknown as SupabaseClient<Database>,
    serviceSupabase: stub as unknown as SupabaseClient<Database>,
    userId: "user-1",
    mode: "team_import",
    getAccessToken: async () => "access-token",
    fetchImpl: mixedGraphResponse(),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    calendars: [
      {
        id: "default-cal",
        name: "Calendar",
        isDefault: true,
      },
      {
        id: "shared-readonly",
        name: "Shared Team Calendar",
        isDefault: false,
        hexColor: "#AABBCC",
      },
    ],
  });
});

test("handleMicrosoftCalendarsGet personal mode excludes read-only shared calendars", async () => {
  const stub = createSupabaseStub();

  const response = await handleMicrosoftCalendarsGet({
    supabase: stub as unknown as SupabaseClient<Database>,
    serviceSupabase: stub as unknown as SupabaseClient<Database>,
    userId: "user-1",
    mode: "personal",
    getAccessToken: async () => "access-token",
    fetchImpl: mixedGraphResponse(),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    calendars: [
      {
        id: "default-cal",
        name: "Calendar",
        isDefault: true,
      },
    ],
  });
});

test("handleMicrosoftCalendarsGet defaults to personal mode when mode is omitted", async () => {
  const stub = createSupabaseStub();

  const response = await handleMicrosoftCalendarsGet({
    supabase: stub as unknown as SupabaseClient<Database>,
    serviceSupabase: stub as unknown as SupabaseClient<Database>,
    userId: "user-1",
    getAccessToken: async () => "access-token",
    fetchImpl: mixedGraphResponse(),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { calendars: Array<{ id: string }> };
  assert.deepEqual(body.calendars.map((c) => c.id), ["default-cal"]);
});

test("handleMicrosoftCalendarsGet team_import mode still returns reconnect_required when token missing", async () => {
  const stub = createSupabaseStub();
  seedConnectedOutlookConnection(stub);

  const response = await handleMicrosoftCalendarsGet({
    supabase: stub as unknown as SupabaseClient<Database>,
    serviceSupabase: stub as unknown as SupabaseClient<Database>,
    userId: "user-1",
    mode: "team_import",
    getAccessToken: async () => null,
    fetchImpl: async () => {
      throw new Error("fetch should not be called when access token is missing");
    },
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "reconnect_required" });
});
