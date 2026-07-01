import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildMobileAuthCallbackUrl,
  buildMobileCallbackDeepLink,
  buildMobileErrorDeepLink,
  isMobileAuthMode,
  mapMobileOAuthProvider,
} from "@/lib/auth/mobile-oauth";
import { getEncryptionKeyBuffer } from "@/lib/crypto/token-encryption";

const SITE = "https://www.myteamnetwork.com";

describe("mapMobileOAuthProvider", () => {
  it("maps friendly mobile slugs to Supabase provider ids", () => {
    assert.equal(mapMobileOAuthProvider("google"), "google");
    assert.equal(mapMobileOAuthProvider("linkedin"), "linkedin_oidc");
    assert.equal(mapMobileOAuthProvider("microsoft"), "azure");
  });

  it("returns null for unsupported providers (route deep-links an error, never 404s)", () => {
    assert.equal(mapMobileOAuthProvider("facebook"), null);
    assert.equal(mapMobileOAuthProvider(""), null);
    assert.equal(mapMobileOAuthProvider("apple"), null);
  });
});

describe("buildMobileAuthCallbackUrl", () => {
  it("targets /auth/callback with mobile=1 so the callback takes the handoff branch", () => {
    const url = new URL(buildMobileAuthCallbackUrl(SITE, { mode: "login" }));
    assert.equal(url.pathname, "/auth/callback");
    assert.equal(url.searchParams.get("mobile"), "1");
    assert.equal(url.searchParams.get("mode"), "login");
    assert.equal(url.searchParams.get("redirect"), "/app");
  });

  it("carries signup age params through the OAuth round-trip", () => {
    const url = new URL(
      buildMobileAuthCallbackUrl(SITE, {
        mode: "signup",
        redirect: "/app/join?token=abc",
        ageBracket: "18_plus",
        isMinor: "false",
        ageToken: "tok123",
      })
    );
    assert.equal(url.searchParams.get("mode"), "signup");
    assert.equal(url.searchParams.get("age_bracket"), "18_plus");
    assert.equal(url.searchParams.get("is_minor"), "false");
    assert.equal(url.searchParams.get("age_token"), "tok123");
    assert.equal(url.searchParams.get("redirect"), "/app/join?token=abc");
  });

  it("falls back to /app for open-redirect attempts", () => {
    const url = new URL(
      buildMobileAuthCallbackUrl(SITE, { mode: "login", redirect: "https://evil.com" })
    );
    assert.equal(url.searchParams.get("redirect"), "/app");
  });
});

describe("buildMobileCallbackDeepLink", () => {
  it("deep-links to the app scheme with the handoff code", () => {
    const link = buildMobileCallbackDeepLink({ handoff_code: "code-xyz" });
    const url = new URL(link);
    assert.equal(url.protocol, "teammeet:");
    assert.equal(url.hostname, "callback");
    assert.equal(url.searchParams.get("handoff_code"), "code-xyz");
  });

  it("omits null/undefined params", () => {
    const link = buildMobileCallbackDeepLink({ handoff_code: "c", error: null });
    assert.ok(!link.includes("error"));
  });
});

describe("buildMobileErrorDeepLink", () => {
  it("deep-links an error the app's callback parser can read", () => {
    const url = new URL(buildMobileErrorDeepLink("oauth_init_failed", "boom"));
    assert.equal(url.protocol, "teammeet:");
    assert.equal(url.hostname, "callback");
    assert.equal(url.searchParams.get("error"), "oauth_init_failed");
    assert.equal(url.searchParams.get("error_description"), "boom");
  });
});

describe("isMobileAuthMode", () => {
  it("accepts login/signup and rejects anything else", () => {
    assert.equal(isMobileAuthMode("login"), true);
    assert.equal(isMobileAuthMode("signup"), true);
    assert.equal(isMobileAuthMode("admin"), false);
    assert.equal(isMobileAuthMode(null), false);
  });
});

describe("AUTH_HANDOFF_ENCRYPTION_KEY format contract", () => {
  // next.config.mjs build-validates AUTH_HANDOFF_ENCRYPTION_KEY as 64 hex chars,
  // mirroring getEncryptionKeyBuffer's check. The config throw path runs at module
  // import (exercised by `next build`), so it is not unit-tested here; this locks
  // the 64-hex format contract the config relies on.
  const VALID_KEY = "a".repeat(64);

  it("accepts a 64 hex-character key", () => {
    const buf = getEncryptionKeyBuffer(VALID_KEY);
    assert.equal(buf.length, 32);
  });

  it("rejects a wrong-length key", () => {
    assert.throws(
      () => getEncryptionKeyBuffer("abc123"),
      /64 hex characters/,
    );
  });

  it("rejects a 64-char non-hex key", () => {
    assert.throws(
      () => getEncryptionKeyBuffer("z".repeat(64)),
      /64 hex characters/,
    );
  });
});
