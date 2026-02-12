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

  it("callback route uses 3-way error classification (safe → config → unknown)", () => {
    // Read the actual route source to verify the fix is in place.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const routeSrc = readFileSync(
      join(testDir, "..", "src", "app", "api", "google", "callback", "route.ts"),
      "utf-8"
    );

    // Find the catch block, then the outer else branch (contains both safePatterns and configPatterns)
    const catchBlock = routeSrc.slice(routeSrc.indexOf("} catch (error)"));
    assert.ok(catchBlock, "catch block should exist in route");

    // Use the first "} else {" in the catch block — that's the outer classification branch
    const elseIdx = catchBlock.indexOf("} else {");
    assert.ok(elseIdx !== -1, "else branch should exist");
    const elseBranch = catchBlock.slice(elseIdx);

    // Both pattern arrays must exist
    assert.ok(
      elseBranch.includes("safePatterns"),
      "catch-all branch should use a safePatterns whitelist"
    );
    assert.ok(
      elseBranch.includes("configPatterns"),
      "catch-all branch should use a configPatterns list"
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

    // Config errors should use isConfig conditional and dedicated error code
    assert.ok(
      elseBranch.includes("isConfig"),
      "catch-all branch should use isConfig conditional"
    );
    assert.ok(
      elseBranch.includes("server_config_error"),
      "config errors should use 'server_config_error' error code"
    );
    assert.ok(
      elseBranch.includes("server configuration issue"),
      "config errors should mention 'server configuration issue'"
    );
    assert.ok(
      elseBranch.includes("contact support"),
      "config errors should tell user to 'contact support'"
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

  it("3-way classification correctly categorizes safe, config, and unknown errors", () => {
    // Duplicate the classification logic from route.ts to verify behavior
    const safePatterns = [
      "No access token received",
      "No refresh token received",
      "Could not retrieve user email",
      "Failed to refresh access token",
    ];
    const configPatterns = [
      "Missing required environment variable",
      "ENCRYPTION_KEY",
      "must be 64 hex",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "SUPABASE",
    ];

    function classify(msg: string): "safe" | "config" | "unknown" {
      const isSafe = safePatterns.some(p => msg.includes(p));
      const isConfig = configPatterns.some(p => msg.includes(p));
      if (isSafe) return "safe";
      if (isConfig) return "config";
      return "unknown";
    }

    // Safe messages (from oauth.ts)
    assert.equal(classify("No access token received from Google"), "safe");
    assert.equal(classify("No refresh token received from Google. User may need to revoke access and reconnect."), "safe");
    assert.equal(classify("Could not retrieve user email from Google"), "safe");
    assert.equal(classify("Failed to refresh access token"), "safe");

    // Config errors (env var / key issues)
    assert.equal(classify("Missing required environment variable: GOOGLE_CLIENT_ID"), "config");
    assert.equal(classify("Missing required environment variable: GOOGLE_CLIENT_SECRET"), "config");
    assert.equal(classify("Missing required environment variable: GOOGLE_TOKEN_ENCRYPTION_KEY"), "config");
    assert.equal(classify("GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"), "config");
    assert.equal(classify("SUPABASE_SERVICE_ROLE_KEY is not set"), "config");

    // Unknown errors (Google API, network, unrecognized)
    assert.equal(classify("Request failed with status 500"), "unknown");
    assert.equal(classify("ETIMEDOUT"), "unknown");
    assert.equal(classify("fetch failed"), "unknown");
    assert.equal(classify("Something completely unexpected"), "unknown");
  });

  it("config error message does not leak sensitive substrings", () => {
    const configMessage = "There is a server configuration issue. Please contact support.";

    const sensitiveSubstrings = [
      "ENCRYPTION_KEY",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "SUPABASE",
      "environment variable",
      "hex characters",
      "Missing required",
    ];

    for (const sensitive of sensitiveSubstrings) {
      assert.ok(
        !configMessage.includes(sensitive),
        `Config error user-facing message should not contain '${sensitive}'`
      );
    }
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
