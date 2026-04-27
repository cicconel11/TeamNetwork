import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildMobileAuthCallbackUrl,
  buildMobileCallbackDeepLink,
  buildMobileErrorDeepLink,
  buildMobileHandoffInsert,
  decryptMobileHandoffToken,
  hashMobileHandoffCode,
  mobileErrorFromCallbackRedirect,
} from "@/lib/auth/mobile-oauth";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("mobile OAuth bridge helpers", () => {
  beforeEach(() => {
    process.env.AUTH_HANDOFF_ENCRYPTION_KEY = TEST_KEY;
  });

  it("builds a web callback URL marked for mobile handoff", () => {
    const url = buildMobileAuthCallbackUrl("https://www.myteamnetwork.com", {
      mode: "signup",
      redirect: "/app/join?code=abc",
      ageBracket: "18_plus",
      isMinor: "false",
      ageToken: "age-token",
    });
    const parsed = new URL(url);

    assert.equal(parsed.pathname, "/auth/callback");
    assert.equal(parsed.searchParams.get("mobile"), "1");
    assert.equal(parsed.searchParams.get("mode"), "signup");
    assert.equal(parsed.searchParams.get("redirect"), "/app/join?code=abc");
    assert.equal(parsed.searchParams.get("age_bracket"), "18_plus");
    assert.equal(parsed.searchParams.get("age_token"), "age-token");
  });

  it("creates encrypted handoff rows without exposing raw session tokens", () => {
    const session = {
      access_token: "raw-access-token",
      refresh_token: "raw-refresh-token",
      user: { id: "user-1" },
    } as any;

    const { code, row } = buildMobileHandoffInsert(session, "one-time-code");

    assert.equal(code, "one-time-code");
    assert.equal(row.code_hash, hashMobileHandoffCode("one-time-code"));
    assert.notEqual(row.encrypted_access_token, "raw-access-token");
    assert.notEqual(row.encrypted_refresh_token, "raw-refresh-token");
    assert.equal(decryptMobileHandoffToken(row.encrypted_access_token), "raw-access-token");
    assert.equal(decryptMobileHandoffToken(row.encrypted_refresh_token), "raw-refresh-token");
  });

  it("builds mobile deep links for success and errors", () => {
    assert.equal(
      buildMobileCallbackDeepLink({ handoff_code: "abc123" }),
      "teammeet://callback?handoff_code=abc123"
    );
    assert.equal(
      buildMobileErrorDeepLink("access_denied", "User cancelled"),
      "teammeet://callback?error=access_denied&error_description=User+cancelled"
    );
  });

  it("converts callback gate redirects into mobile auth errors", () => {
    const deepLink = mobileErrorFromCallbackRedirect(
      "https://www.myteamnetwork.com/auth/signup?error=Age+verification+required"
    );
    const parsed = new URL(deepLink);

    assert.equal(parsed.protocol, "teammeet:");
    assert.equal(parsed.hostname, "callback");
    assert.equal(parsed.searchParams.get("error"), "age_validation_failed");
    assert.equal(parsed.searchParams.get("error_description"), "Age verification required");
  });
});
