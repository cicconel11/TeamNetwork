import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

process.env.MICROSOFT_CLIENT_ID = "test-client-id";
process.env.MICROSOFT_CLIENT_SECRET = "test-client-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import {
  encryptToken,
  refreshAndStoreMicrosoftToken,
  storeMicrosoftConnection,
} from "@/lib/microsoft/oauth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

test("storeMicrosoftConnection stores Outlook default-calendar target as null", async () => {
  const stub = createSupabaseStub();

  const result = await storeMicrosoftConnection(
    stub as unknown as SupabaseClient<Database>,
    "user-1",
    {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-05-01T12:00:00.000Z"),
      email: "user@example.com",
    },
  );

  assert.equal(result.success, true);

  const rows = stub.getRows("user_calendar_connections");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "outlook");
  assert.equal(rows[0].target_calendar_id, null);
});

test("storeMicrosoftConnection preserves an existing Outlook target calendar on reconnect", async () => {
  const stub = createSupabaseStub();
  const supabase = stub as unknown as SupabaseClient<Database>;

  stub.seed("user_calendar_connections", [{
    id: "conn-1",
    user_id: "user-1",
    provider: "outlook",
    provider_email: "old@example.com",
    access_token_encrypted: encryptToken("old-access"),
    refresh_token_encrypted: encryptToken("old-refresh"),
    token_expires_at: "2026-03-01T11:00:00.000Z",
    status: "reconnect_required",
    target_calendar_id: "calendar-123",
    last_sync_at: null,
  }]);

  const result = await storeMicrosoftConnection(
    supabase,
    "user-1",
    {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: new Date("2026-05-01T12:00:00.000Z"),
      email: "new@example.com",
    },
  );

  assert.equal(result.success, true);

  const [row] = stub.getRows("user_calendar_connections");
  assert.equal(row.provider, "outlook");
  assert.equal(row.provider_email, "new@example.com");
  assert.equal(row.target_calendar_id, "calendar-123");
  assert.equal(row.status, "connected");
});

test("refreshAndStoreMicrosoftToken serializes refresh token rotation per user", async () => {
  const stub = createSupabaseStub();
  const supabase = stub as unknown as SupabaseClient<Database>;

  stub.seed("user_calendar_connections", [{
    id: "conn-1",
    user_id: "user-1",
    provider: "outlook",
    provider_email: "user@example.com",
    access_token_encrypted: encryptToken("expired-access"),
    refresh_token_encrypted: encryptToken("refresh-token-1"),
    token_expires_at: "2026-03-01T11:00:00.000Z",
    status: "connected",
    target_calendar_id: null,
    last_sync_at: null,
  }]);

  let lockOwner: string | null = null;
  stub.registerRpc("claim_microsoft_token_refresh_lock", ({ p_user_id, p_lock_id, p_lock_expires_at }) => {
    if (lockOwner) {
      return false;
    }

    lockOwner = String(p_lock_id);
    stub
      .from("user_calendar_connections")
      .update({
        microsoft_refresh_lock_id: p_lock_id,
        microsoft_refresh_lock_expires_at: p_lock_expires_at,
      })
      .eq("user_id", p_user_id)
      .eq("provider", "outlook");

    return true;
  });
  stub.registerRpc("release_microsoft_token_refresh_lock", ({ p_user_id, p_lock_id }) => {
    if (lockOwner !== p_lock_id) {
      return false;
    }

    lockOwner = null;
    stub
      .from("user_calendar_connections")
      .update({
        microsoft_refresh_lock_id: null,
        microsoft_refresh_lock_expires_at: null,
      })
      .eq("user_id", p_user_id)
      .eq("provider", "outlook");

    return true;
  });

  let fetchCalls = 0;
  let releaseFirstRequest: (() => void) | null = null;
  const firstRequestStarted = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });

  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  global.fetch = (async () => {
    fetchCalls++;

    if (fetchCalls === 1) {
      await firstRequestStarted;
      return new Response(JSON.stringify({
        access_token: "new-access-token",
        refresh_token: "refresh-token-2",
        expires_in: 3600,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      error: "invalid_grant",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  global.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  try {
    const first = refreshAndStoreMicrosoftToken(supabase, "user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = refreshAndStoreMicrosoftToken(supabase, "user-1");

    releaseFirstRequest?.();

    const [firstToken, secondToken] = await Promise.all([first, second]);

    assert.equal(fetchCalls, 1, "Only one token refresh request should reach Microsoft");
    assert.equal(firstToken, "new-access-token");
    assert.equal(secondToken, "new-access-token");

    const [connection] = stub.getRows("user_calendar_connections");
    assert.equal(connection.status, "connected");
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
});
