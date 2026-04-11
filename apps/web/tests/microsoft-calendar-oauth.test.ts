import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set env vars before any module imports that may validate them
process.env.MICROSOFT_CLIENT_ID = "test-client-id";
process.env.MICROSOFT_CLIENT_SECRET = "test-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

// Use the same key that Google tests use — shared AES-256 key (64 hex chars = 32 bytes)
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

import {
  getMicrosoftAuthorizationUrl,
  getMicrosoftOAuthErrorMessage,
  storeMicrosoftConnection,
} from "@/lib/microsoft/oauth";
import { encryptToken, decryptToken } from "@/lib/crypto/token-encryption";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

describe("getMicrosoftAuthorizationUrl", () => {
  it("returns a URL pointing to the Microsoft login endpoint", () => {
    const state = "test-user-id:1234567890:aGVsbG8=";
    const url = getMicrosoftAuthorizationUrl(state);

    assert.ok(
      url.includes("login.microsoftonline.com"),
      `Expected URL to contain 'login.microsoftonline.com', got: ${url}`
    );
  });

  it("includes the Calendars.ReadWrite scope", () => {
    const state = "test-user-id:1234567890:aGVsbG8=";
    const url = getMicrosoftAuthorizationUrl(state);

    assert.ok(
      url.includes("Calendars.ReadWrite"),
      `Expected URL to contain 'Calendars.ReadWrite', got: ${url}`
    );
  });

  it("includes Calendars.Read.Shared scope so team imports can list shared calendars", () => {
    const state = "test-user-id:1234567890:aGVsbG8=";
    const url = getMicrosoftAuthorizationUrl(state);

    assert.ok(
      url.includes("Calendars.Read.Shared"),
      `Expected URL to contain 'Calendars.Read.Shared', got: ${url}`
    );
  });

  it("includes offline_access scope for refresh token", () => {
    const state = "test-user-id:1234567890:aGVsbG8=";
    const url = getMicrosoftAuthorizationUrl(state);

    assert.ok(
      url.includes("offline_access"),
      `Expected URL to contain 'offline_access', got: ${url}`
    );
  });

  it("includes prompt=consent to force re-consent and get refresh token", () => {
    const state = "test-user-id:1234567890:aGVsbG8=";
    const url = getMicrosoftAuthorizationUrl(state);

    assert.ok(
      url.includes("prompt=consent"),
      `Expected URL to contain 'prompt=consent', got: ${url}`
    );
  });

  it("embeds the state param in the URL", () => {
    const state = "user-abc:9999999:encodedRedirect";
    const url = getMicrosoftAuthorizationUrl(state);

    assert.ok(
      url.includes(encodeURIComponent(state)) || url.includes(state),
      `Expected URL to contain state param '${state}', got: ${url}`
    );
  });
});

describe("getMicrosoftOAuthErrorMessage", () => {
  it("returns the admin consent message for AADSTS65001", () => {
    const message = getMicrosoftOAuthErrorMessage("AADSTS65001");

    assert.ok(
      typeof message === "string" && message.length > 0,
      "Should return a non-empty string"
    );
    // The message should indicate an admin consent or permission issue
    const lowerMessage = message.toLowerCase();
    assert.ok(
      lowerMessage.includes("admin") ||
        lowerMessage.includes("consent") ||
        lowerMessage.includes("permission"),
      `Expected admin consent message for AADSTS65001, got: "${message}"`
    );
  });

  it("returns the access denied message for access_denied", () => {
    const message = getMicrosoftOAuthErrorMessage("access_denied");

    assert.ok(
      typeof message === "string" && message.length > 0,
      "Should return a non-empty string"
    );
    const lowerMessage = message.toLowerCase();
    assert.ok(
      lowerMessage.includes("denied") ||
        lowerMessage.includes("access") ||
        lowerMessage.includes("allow"),
      `Expected access denied message, got: "${message}"`
    );
  });

  it("returns a generic fallback message for unknown error codes", () => {
    const message = getMicrosoftOAuthErrorMessage("unknown_error");

    assert.ok(
      typeof message === "string" && message.length > 0,
      "Should return a non-empty fallback string"
    );
  });

  it("returns different messages for different known error codes", () => {
    const adminMsg = getMicrosoftOAuthErrorMessage("AADSTS65001");
    const deniedMsg = getMicrosoftOAuthErrorMessage("access_denied");

    // They should differ — each error has its own explanation
    assert.notEqual(
      adminMsg,
      deniedMsg,
      "AADSTS65001 and access_denied should produce different messages"
    );
  });
});

describe("token encryption round-trip (shared crypto module)", () => {
  it("encrypts and decrypts a token without data loss", () => {
    const original = "ya29.microsoft-access-token-example";
    const encrypted = encryptToken(original, TEST_ENCRYPTION_KEY);
    const decrypted = decryptToken(encrypted, TEST_ENCRYPTION_KEY);

    assert.equal(decrypted, original, "Round-trip should recover the original token");
  });

  it("produces different ciphertext each call (random IV)", () => {
    const token = "some-refresh-token-value";
    const enc1 = encryptToken(token, TEST_ENCRYPTION_KEY);
    const enc2 = encryptToken(token, TEST_ENCRYPTION_KEY);

    assert.notEqual(enc1, enc2, "Two encryptions of the same value should differ (random IV)");
  });

  it("throws on tampered ciphertext (auth tag mismatch)", () => {
    const encrypted = encryptToken("original-value", TEST_ENCRYPTION_KEY);
    const parts = encrypted.split(":");
    // Corrupt the ciphertext portion
    const corrupted = `${parts[0]}:${parts[1]}:AAAAAAAAAAAAAAAA`;

    assert.throws(
      () => decryptToken(corrupted, TEST_ENCRYPTION_KEY),
      "Should throw when auth tag verification fails"
    );
  });

  it("throws on malformed encrypted string (wrong number of segments)", () => {
    assert.throws(
      () => decryptToken("not-a-valid-format", TEST_ENCRYPTION_KEY),
      "Should throw on invalid encrypted token format"
    );
  });
});

describe("storeMicrosoftConnection", () => {
  const tokens = {
    accessToken: "access-token-value",
    refreshToken: "refresh-token-value",
    expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    email: "user@example.com",
  };

  it("stores a new connection with provider='outlook' and encrypted tokens", async () => {
    const stub = createSupabaseStub();
    const supabase = stub as unknown as SupabaseClient<Database>;

    const result = await storeMicrosoftConnection(supabase, "user-1", tokens);

    assert.equal(result.success, true);
    const rows = stub.getRows("user_calendar_connections");
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.user_id, "user-1");
    assert.equal(row.provider, "outlook");
    assert.equal(row.provider_email, "user@example.com");
    assert.equal(row.status, "connected");
    // Tokens should be stored encrypted, not as plaintext
    assert.notEqual(row.access_token_encrypted, "access-token-value");
    assert.notEqual(row.refresh_token_encrypted, "refresh-token-value");
  });

  it("preserves existing target_calendar_id on reconnect", async () => {
    const stub = createSupabaseStub();
    const supabase = stub as unknown as SupabaseClient<Database>;

    stub.seed("user_calendar_connections", [{
      id: "conn-1",
      user_id: "user-1",
      provider: "outlook",
      provider_email: "old@example.com",
      access_token_encrypted: encryptToken("old-access", TEST_ENCRYPTION_KEY),
      refresh_token_encrypted: encryptToken("old-refresh", TEST_ENCRYPTION_KEY),
      token_expires_at: "2026-01-01T00:00:00.000Z",
      status: "reconnect_required",
      target_calendar_id: "my-saved-calendar-id",
      last_sync_at: null,
    }]);

    const result = await storeMicrosoftConnection(supabase, "user-1", tokens);

    assert.equal(result.success, true);
    const rows = stub.getRows("user_calendar_connections").filter((r) => r.user_id === "user-1" && r.provider === "outlook");
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].target_calendar_id,
      "my-saved-calendar-id",
      "Reconnect must preserve the user's previously chosen target_calendar_id"
    );
    assert.equal(rows[0].status, "connected");
    assert.equal(rows[0].provider_email, "user@example.com");
  });

  it("stores null target_calendar_id for a first-time connection", async () => {
    const stub = createSupabaseStub();
    const supabase = stub as unknown as SupabaseClient<Database>;

    await storeMicrosoftConnection(supabase, "user-1", tokens);

    const row = stub.getRows("user_calendar_connections")[0];
    assert.equal(row.target_calendar_id, null);
  });
});
