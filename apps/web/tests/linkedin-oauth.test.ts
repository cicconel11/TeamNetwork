import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set env vars before importing the module
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.LINKEDIN_CLIENT_ID = "test-client-id";
process.env.LINKEDIN_CLIENT_SECRET = "test-client-secret";
process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = TEST_KEY;
process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
delete process.env.NEXT_PUBLIC_SITE_URL;

import {
  getLinkedInAuthUrl,
  isTokenExpired,
  getLinkedInOAuthErrorMessage,
  encryptToken,
  decryptToken,
} from "@/lib/linkedin/oauth";

describe("linkedin-oauth", () => {
  describe("getLinkedInAuthUrl", () => {
    it("returns a URL with correct base and params", () => {
      const url = getLinkedInAuthUrl("test-state-123");
      const parsed = new URL(url);

      assert.equal(parsed.origin, "https://www.linkedin.com");
      assert.equal(parsed.pathname, "/oauth/v2/authorization");
      assert.equal(parsed.searchParams.get("response_type"), "code");
      assert.equal(parsed.searchParams.get("client_id"), "test-client-id");
      assert.equal(parsed.searchParams.get("state"), "test-state-123");
      assert.equal(parsed.searchParams.get("scope"), "openid profile email");
      assert.ok(
        !parsed.searchParams.get("scope")?.includes("offline_access"),
        "LinkedIn OIDC auth URLs must not request offline_access",
      );
      assert.equal(
        parsed.searchParams.get("redirect_uri"),
        "https://example.com/api/linkedin/callback"
      );
    });

    it("prefers NEXT_PUBLIC_SITE_URL over NEXT_PUBLIC_APP_URL for callback URIs", () => {
      process.env.NEXT_PUBLIC_SITE_URL = "https://preview.myteamnetwork.com";
      process.env.NEXT_PUBLIC_APP_URL = "https://example.com";

      const url = getLinkedInAuthUrl("test-state-456");
      const parsed = new URL(url);

      assert.equal(
        parsed.searchParams.get("redirect_uri"),
        "https://preview.myteamnetwork.com/api/linkedin/callback"
      );

      delete process.env.NEXT_PUBLIC_SITE_URL;
      process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    });

    it("ignores malformed NEXT_PUBLIC_SITE_URL and falls back to NEXT_PUBLIC_APP_URL", () => {
      process.env.NEXT_PUBLIC_SITE_URL = "not-a-valid-url";
      process.env.NEXT_PUBLIC_APP_URL = "https://example.com";

      const url = getLinkedInAuthUrl("test-state-789");
      const parsed = new URL(url);

      assert.equal(
        parsed.searchParams.get("redirect_uri"),
        "https://example.com/api/linkedin/callback"
      );

      delete process.env.NEXT_PUBLIC_SITE_URL;
      process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    });
  });

  describe("isTokenExpired", () => {
    it("returns false for future expiry", () => {
      const future = new Date(Date.now() + 3600 * 1000);
      assert.equal(isTokenExpired(future), false);
    });

    it("returns true for past expiry", () => {
      const past = new Date(Date.now() - 1000);
      assert.equal(isTokenExpired(past), true);
    });

    it("returns true within buffer window", () => {
      // Expires in 2 minutes, buffer is 5 minutes
      const soon = new Date(Date.now() + 120 * 1000);
      assert.equal(isTokenExpired(soon, 300), true);
    });

    it("returns false outside buffer window", () => {
      const soon = new Date(Date.now() + 600 * 1000);
      assert.equal(isTokenExpired(soon, 300), false);
    });

    it("returns true when expiry equals buffer boundary", () => {
      // Exactly at the buffer edge — should be expired
      const exactBuffer = new Date(Date.now() + 300 * 1000);
      assert.equal(isTokenExpired(exactBuffer, 300), true);
    });
  });

  describe("encryptToken / decryptToken", () => {
    it("round-trips a token", () => {
      const token = "ya29.linkedin-access-token";
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);
      assert.equal(decrypted, token);
    });

    it("produces different ciphertext for same plaintext (random IV)", () => {
      const token = "same-token";
      const a = encryptToken(token);
      const b = encryptToken(token);
      assert.notEqual(a, b);
    });

    it("handles empty string", () => {
      const encrypted = encryptToken("");
      const decrypted = decryptToken(encrypted);
      assert.equal(decrypted, "");
    });
  });

  describe("getLinkedInOAuthErrorMessage", () => {
    it("returns specific message for access_denied", () => {
      const msg = getLinkedInOAuthErrorMessage("access_denied");
      assert.ok(msg.includes("denied access"));
    });

    it("returns specific message for user_cancelled_login", () => {
      const msg = getLinkedInOAuthErrorMessage("user_cancelled_login");
      assert.ok(msg.includes("cancelled"));
    });

    it("returns specific message for server_error", () => {
      const msg = getLinkedInOAuthErrorMessage("server_error");
      assert.ok(msg.includes("servers"));
    });

    it("returns generic message for unknown error", () => {
      const msg = getLinkedInOAuthErrorMessage("some_unknown_error");
      assert.ok(msg.includes("unexpected error"));
    });
  });
});
