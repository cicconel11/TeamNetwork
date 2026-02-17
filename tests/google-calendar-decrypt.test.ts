import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub";
import {
  getCalendarConnection,
  getValidAccessToken,
  encryptToken,
} from "@/lib/google/oauth";

// Set a valid 64-hex-char encryption key for tests
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Google OAuth env vars (needed by createOAuth2Client in refreshAndStoreToken path)
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

const USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("getCalendarConnection – decryption failures", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("returns null when stored tokens are corrupted (not valid encrypted format)", async () => {
    stub.seed("user_calendar_connections", [
      {
        user_id: USER_ID,
        google_email: "user@gmail.com",
        access_token_encrypted: "not-a-valid-encrypted-token",
        refresh_token_encrypted: "also-garbage",
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        status: "connected",
        target_calendar_id: "primary",
        last_sync_at: null,
      },
    ]);

    const result = await getCalendarConnection(stub as never, USER_ID);
    assert.equal(result, null, "should return null for corrupted tokens");
  });

  it("returns null when encrypted token has invalid ciphertext (decryption auth tag fails)", async () => {
    // Valid format (iv:authTag:ciphertext) but with garbage ciphertext
    const fakeIv = Buffer.from("aabbccddeeff0011aabbccdd", "hex").toString("base64");
    const fakeTag = Buffer.from("00112233445566778899aabbccddeeff", "hex").toString("base64");
    const fakeCipher = Buffer.from("corrupted-data").toString("base64");
    const corruptedToken = `${fakeIv}:${fakeTag}:${fakeCipher}`;

    stub.seed("user_calendar_connections", [
      {
        user_id: USER_ID,
        google_email: "user@gmail.com",
        access_token_encrypted: corruptedToken,
        refresh_token_encrypted: corruptedToken,
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        status: "connected",
        target_calendar_id: "primary",
        last_sync_at: null,
      },
    ]);

    const result = await getCalendarConnection(stub as never, USER_ID);
    assert.equal(result, null, "should return null when auth tag verification fails");
  });

  it("returns connection object when tokens are valid", async () => {
    const validAccess = encryptToken("ya29.valid-access-token");
    const validRefresh = encryptToken("1//valid-refresh-token");

    stub.seed("user_calendar_connections", [
      {
        user_id: USER_ID,
        google_email: "user@gmail.com",
        access_token_encrypted: validAccess,
        refresh_token_encrypted: validRefresh,
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        status: "connected",
        target_calendar_id: "primary",
        last_sync_at: null,
      },
    ]);

    const result = await getCalendarConnection(stub as never, USER_ID);
    assert.notEqual(result, null, "should return connection object");
    assert.equal(result!.accessToken, "ya29.valid-access-token");
    assert.equal(result!.refreshToken, "1//valid-refresh-token");
    assert.equal(result!.googleEmail, "user@gmail.com");
  });
});

describe("getValidAccessToken – decryption failures", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  it("returns null (does not throw) when stored tokens are corrupted", async () => {
    stub.seed("user_calendar_connections", [
      {
        user_id: USER_ID,
        google_email: "user@gmail.com",
        access_token_encrypted: "garbage-data",
        refresh_token_encrypted: "garbage-data",
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        status: "connected",
        target_calendar_id: "primary",
        last_sync_at: null,
      },
    ]);

    const result = await getValidAccessToken(stub as never, USER_ID);
    assert.equal(result, null, "should return null instead of throwing");
  });
});
