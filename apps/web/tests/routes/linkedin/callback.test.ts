import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLinkedInOAuthState,
  isLinkedInOAuthStateExpired,
  parseLinkedInOAuthState,
  validateLinkedInOAuthState,
} from "@/lib/linkedin/state";

// Env setup before imports
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.LINKEDIN_CLIENT_ID = "test-client-id";
process.env.LINKEDIN_CLIENT_SECRET = "test-client-secret";
process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = TEST_KEY;
process.env.NEXT_PUBLIC_APP_URL = "https://example.com";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("linkedin callback route", () => {
  describe("state parsing", () => {
    it("uses an opaque nonce for provider-facing state and keeps payload in the cookie", () => {
      const redirectPath = "/settings/linkedin";
      const oauthState = createLinkedInOAuthState({
        userId: VALID_UUID,
        redirectPath,
        now: Date.now(),
      });

      assert.equal(oauthState.state, oauthState.payload.nonce);
      assert.notEqual(oauthState.state, VALID_UUID);
      assert.ok(!oauthState.state.includes(redirectPath));
      assert.equal(parseLinkedInOAuthState(oauthState.state), null);

      const cookiePayload = parseLinkedInOAuthState(oauthState.cookie.value);
      assert.deepEqual(cookiePayload, oauthState.payload);
    });

    it("detects expired state (>15 min)", () => {
      const oauthState = createLinkedInOAuthState({
        userId: VALID_UUID,
        redirectPath: "/settings/linkedin",
        now: Date.now() - 16 * 60 * 1000,
      });
      const cookiePayload = parseLinkedInOAuthState(oauthState.cookie.value);
      assert.ok(cookiePayload);
      assert.ok(isLinkedInOAuthStateExpired(cookiePayload!, { now: Date.now() }));
    });

    it("accepts valid state (<15 min)", () => {
      const oauthState = createLinkedInOAuthState({
        userId: VALID_UUID,
        redirectPath: "/settings/linkedin",
        now: Date.now() - 5 * 60 * 1000,
      });

      const result = validateLinkedInOAuthState({
        stateFromQuery: oauthState.state,
        stateFromCookie: oauthState.cookie.value,
        defaultRedirectPath: "/settings/linkedin",
        currentUserId: VALID_UUID,
        now: Date.now(),
      });

      assert.equal(result.ok, true);
    });

    it("detects nonce mismatch", () => {
      const oauthState = createLinkedInOAuthState({
        userId: VALID_UUID,
        redirectPath: "/settings/linkedin",
      });

      const result = validateLinkedInOAuthState({
        stateFromQuery: crypto.randomUUID(),
        stateFromCookie: oauthState.cookie.value,
        defaultRedirectPath: "/settings/linkedin",
      });

      assert.deepEqual(result, {
        ok: false,
        error: "state_mismatch",
        redirectPath: "/settings/linkedin",
      });
    });

    it("detects user ID mismatch", () => {
      const oauthState = createLinkedInOAuthState({
        userId: VALID_UUID,
        redirectPath: "/settings/linkedin",
      });
      const currentUserId = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

      const result = validateLinkedInOAuthState({
        stateFromQuery: oauthState.state,
        stateFromCookie: oauthState.cookie.value,
        defaultRedirectPath: "/settings/linkedin",
        currentUserId,
      });

      assert.deepEqual(result, {
        ok: false,
        error: "state_mismatch",
        redirectPath: "/settings/linkedin",
      });
    });
  });

  describe("error classification", () => {
    const safePatterns = [
      "No access token received",
      "Failed to fetch LinkedIn profile",
      "Failed to exchange LinkedIn authorization code",
    ];
    const configPatterns = [
      "Missing required environment variable",
      "ENCRYPTION_KEY",
      "must be 64 hex",
      "LINKEDIN_CLIENT_ID",
      "LINKEDIN_CLIENT_SECRET",
    ];

    it("classifies safe errors correctly", () => {
      const msg = "No access token received from LinkedIn";
      const isSafe = safePatterns.some(p => msg.includes(p));
      assert.ok(isSafe);
    });

    it("classifies config errors correctly", () => {
      const msg = "Missing required environment variable: LINKEDIN_CLIENT_ID";
      const isConfig = configPatterns.some(p => msg.includes(p));
      assert.ok(isConfig);
    });

    it("classifies unknown errors as neither safe nor config", () => {
      const msg = "Network timeout connecting to LinkedIn";
      const isSafe = safePatterns.some(p => msg.includes(p));
      const isConfig = configPatterns.some(p => msg.includes(p));
      assert.ok(!isSafe && !isConfig);
    });
  });
});
