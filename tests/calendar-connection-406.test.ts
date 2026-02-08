import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("callback route sanitizes server config errors via safePatterns whitelist", () => {
    // Read the actual route source to verify the fix is in place.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const routeSrc = readFileSync(
      join(testDir, "..", "src", "app", "api", "google", "callback", "route.ts"),
      "utf-8"
    );

    // Find the else branch of the catch block's error classification
    const catchBlock = routeSrc.slice(routeSrc.indexOf("} catch (error)"));
    assert.ok(catchBlock, "catch block should exist in route");

    const elseBranch = catchBlock.slice(catchBlock.lastIndexOf("} else {"));
    assert.ok(elseBranch, "else branch should exist");

    // The else branch must contain a safePatterns whitelist
    assert.ok(
      elseBranch.includes("safePatterns"),
      "catch-all branch should use a safePatterns whitelist"
    );

    // Known user-friendly messages should be in the whitelist
    assert.ok(
      elseBranch.includes("No access token received"),
      "safePatterns should include 'No access token received'"
    );
    assert.ok(
      elseBranch.includes("No refresh token received"),
      "safePatterns should include 'No refresh token received'"
    );

    // Server config errors (e.g. ENCRYPTION_KEY) must NOT pass through
    assert.ok(
      !elseBranch.includes("ENCRYPTION_KEY"),
      "catch-all branch should NOT leak server config error patterns"
    );

    // A generic fallback message should be used for unrecognized errors
    assert.ok(
      elseBranch.includes("An unexpected error occurred"),
      "catch-all branch should have a generic fallback for unrecognized errors"
    );

    // The branch should use isSafe conditional to decide which message to show
    assert.ok(
      elseBranch.includes("isSafe"),
      "catch-all branch should use isSafe conditional"
    );
  });

  it("exchangeCodeForTokens throws user-friendly error messages", async () => {
    // Verify the errors from exchangeCodeForTokens are user-friendly strings
    // that are safe to show to users (no stack traces, no sensitive data)
    const { exchangeCodeForTokens } = await import("@/lib/google/oauth");
    const { google } = await import("googleapis");

    const originalGetToken = google.auth.OAuth2.prototype.getToken;
    google.auth.OAuth2.prototype.getToken = async () =>
      ({
        tokens: {
          refresh_token: "fake-refresh-token",
        },
      }) as Awaited<ReturnType<typeof originalGetToken>>;

    try {
      await exchangeCodeForTokens("fake-code");
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err instanceof Error, "should throw an Error instance");
      assert.equal(err.message, "No access token received from Google");
      // The error message should be a readable string, not a raw stack trace
      assert.ok(err.message.length > 0, "error message should not be empty");
      assert.ok(err.message.length < 200, "error message should be concise, not a stack trace");
    } finally {
      google.auth.OAuth2.prototype.getToken = originalGetToken;
    }
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
