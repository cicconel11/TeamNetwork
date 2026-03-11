import assert from "node:assert";
import { describe, it } from "node:test";

import { buildErrorRedirect } from "../src/lib/auth/callback-flow";
import { buildOAuthSignupCallbackUrl, sanitizeRedirectPath } from "../src/lib/auth/redirect";
import {
  buildAuthRetryHref,
  shouldResumeSignupRegistration,
} from "../src/lib/auth/signup-flow";
import { validateSiteUrl } from "../src/lib/supabase/config";

const siteUrl = "https://www.myteamnetwork.com";

describe("OAuth signup callback URLs", () => {
  it("encodes base64 special characters in age_token", () => {
    const token = "eyJhZ2VCcmFja2V0IjoiMThfcGx1cyIs+bWlub3I/falSe==";
    const url = buildOAuthSignupCallbackUrl(siteUrl, "/app", "18_plus", false, token);

    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get("age_token"), token);
    assert.ok(url.includes("%2B") || url.includes("%2F") || url.includes("%3D"));
  });

  it("preserves invite redirects alongside age params", () => {
    const redirectTo = "/app/join?token=abc123";
    const url = buildOAuthSignupCallbackUrl(siteUrl, redirectTo, "18_plus", false, "test-token");

    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get("redirect"), redirectTo);
    assert.strictEqual(parsed.searchParams.get("mode"), "signup");
  });

  it("sanitizes external redirect targets", () => {
    const url = buildOAuthSignupCallbackUrl(siteUrl, "https://evil.com", "18_plus", false, "token");
    const parsed = new URL(url);

    assert.strictEqual(parsed.searchParams.get("redirect"), "/app");
  });
});

describe("Auth retry routing", () => {
  it("routes signup retries back to signup", () => {
    assert.strictEqual(
      buildAuthRetryHref("signup", "/app/join?token=X"),
      `/auth/signup?redirect=${encodeURIComponent("/app/join?token=X")}`
    );
  });

  it("sanitizes retry redirects before building links", () => {
    assert.strictEqual(buildAuthRetryHref("signup", "https://evil.com"), "/auth/signup");
    assert.strictEqual(buildAuthRetryHref(undefined, "https://evil.com"), "/auth/login");
  });
});

describe("Auth error redirects", () => {
  it("preserves redirect and mode", () => {
    const url = buildErrorRedirect(siteUrl, "bad_oauth_state", "/app/join?token=X", "signup");
    const parsed = new URL(url);

    assert.strictEqual(parsed.searchParams.get("message"), "bad_oauth_state");
    assert.strictEqual(parsed.searchParams.get("redirect"), "/app/join?token=X");
    assert.strictEqual(parsed.searchParams.get("mode"), "signup");
  });

  it("sanitizes external redirect params", () => {
    const url = buildErrorRedirect(siteUrl, "bad_oauth_state", "https://evil.com", "signup");
    const parsed = new URL(url);

    assert.strictEqual(parsed.searchParams.has("redirect"), false);
  });
});

describe("Signup age-gate resume rules", () => {
  it("does not resume registration after an expired age-token error", () => {
    assert.strictEqual(
      shouldResumeSignupRegistration({
        initialError: "Age verification expired. Please try again.",
        hasStoredAgeGateData: true,
      }),
      false
    );
  });

  it("resumes registration after non-age OAuth errors", () => {
    assert.strictEqual(
      shouldResumeSignupRegistration({
        initialError: "OAuth popup was closed before completing sign in.",
        hasStoredAgeGateData: true,
      }),
      true
    );
  });
});

describe("Site URL validation", () => {
  it("rejects malformed production site URLs", () => {
    assert.throws(
      () => validateSiteUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "not-a-url",
      }),
      /canonical production origin/
    );
  });

  it("rejects non-canonical Vercel production hosts", () => {
    assert.throws(
      () => validateSiteUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://preview.myteamnetwork.com",
      }),
      /canonical production origin/
    );
  });

  it("allows preview runtimes without a configured site URL", () => {
    assert.doesNotThrow(() => validateSiteUrl({
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    }));
  });
});

describe("Redirect sanitization", () => {
  it("preserves invite tokens", () => {
    assert.strictEqual(sanitizeRedirectPath("/app/join?token=abc123"), "/app/join?token=abc123");
  });

  it("blocks external URLs", () => {
    assert.strictEqual(sanitizeRedirectPath("https://evil.com"), "/app");
  });
});
