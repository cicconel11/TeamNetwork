import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub";
import { getCalendarConnection } from "@/lib/google/oauth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Set required env vars for oauth module
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "a".repeat(64);

describe("calendar-connection 406 bug", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("BUG REPRO: .single() on empty user_calendar_connections returns PGRST116 error", () => {
    const result = stub
      .from("user_calendar_connections")
      .select("*")
      .eq("user_id", "nonexistent-user")
      .single();

    assert.ok(result.error, "expected an error from .single() on empty table");
    assert.equal(result.error!.code, "PGRST116");
    assert.equal(result.data, null);
  });

  it("FIX VERIFICATION: .maybeSingle() on empty user_calendar_connections returns null without error", () => {
    const result = stub
      .from("user_calendar_connections")
      .select("*")
      .eq("user_id", "nonexistent-user")
      .maybeSingle();

    assert.equal(result.error, null, "expected no error from .maybeSingle()");
    assert.equal(result.data, null, "expected null data when no rows found");
  });

  it("getCalendarConnection() returns null when no connection exists (no throw)", async () => {
    const supabase = stub as unknown as SupabaseClient<Database>;
    const result = await getCalendarConnection(supabase, "nonexistent-user");
    assert.equal(result, null, "should return null for missing connection");
  });

  it("getCalendarConnection() returns data when connection exists", async () => {
    // We need to encrypt tokens the same way the module does
    const { encryptToken } = await import("@/lib/google/oauth");

    const userId = "test-user-123";
    const encAccess = encryptToken("access-token-123");
    const encRefresh = encryptToken("refresh-token-456");

    stub.seed("user_calendar_connections", [
      {
        user_id: userId,
        google_email: "test@gmail.com",
        access_token_encrypted: encAccess,
        refresh_token_encrypted: encRefresh,
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        status: "connected",
        last_sync_at: null,
      },
    ]);

    const supabase = stub as unknown as SupabaseClient<Database>;
    const result = await getCalendarConnection(supabase, userId);

    assert.ok(result, "should return connection data");
    assert.equal(result!.googleEmail, "test@gmail.com");
    assert.equal(result!.accessToken, "access-token-123");
    assert.equal(result!.refreshToken, "refresh-token-456");
    assert.equal(result!.status, "connected");
  });
});
