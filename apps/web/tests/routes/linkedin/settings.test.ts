import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  optionalLinkedInProfileUrlSchema,
  isLinkedInProfileUrl,
  normalizeLinkedInProfileUrl,
} from "@/lib/alumni/linkedin-url";

import {
  createLinkedInOAuthState,
  parseLinkedInOAuthState,
} from "@/lib/linkedin/state";

describe("LinkedIn settings routes", () => {
  describe("URL validation (optionalLinkedInProfileUrlSchema)", () => {
    it("accepts a valid LinkedIn profile URL", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://www.linkedin.com/in/johndoe"
      );
      assert.ok(result.success);
    });

    it("normalizes http to https", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "http://www.linkedin.com/in/johndoe"
      );
      assert.ok(result.success);
      assert.ok(result.data?.startsWith("https://"));
    });

    it("normalizes linkedin.com to www.linkedin.com", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://linkedin.com/in/johndoe"
      );
      assert.ok(result.success);
      assert.ok(result.data?.includes("www.linkedin.com"));
    });

    it("rejects non-LinkedIn URLs", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://example.com/in/johndoe"
      );
      assert.ok(!result.success);
    });

    it("rejects URLs without /in/ path", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(
        "https://www.linkedin.com/company/acme"
      );
      assert.ok(!result.success);
    });

    it("accepts empty string (clear URL)", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse("");
      assert.ok(result.success);
    });

    it("accepts undefined (optional)", () => {
      const result = optionalLinkedInProfileUrlSchema.safeParse(undefined);
      assert.ok(result.success);
    });

    it("strips trailing slashes", () => {
      const normalized = normalizeLinkedInProfileUrl(
        "https://www.linkedin.com/in/johndoe/"
      );
      assert.ok(!normalized.endsWith("/"));
    });
  });

  describe("isLinkedInProfileUrl", () => {
    it("returns true for valid URL", () => {
      assert.ok(isLinkedInProfileUrl("https://www.linkedin.com/in/jane-doe"));
    });

    it("returns false for empty string", () => {
      assert.ok(!isLinkedInProfileUrl(""));
    });

    it("returns false for non-URL string", () => {
      assert.ok(!isLinkedInProfileUrl("not a url"));
    });
  });


  describe("connect route state format", () => {
    it("stores the payload in the cookie while keeping provider-facing state opaque", () => {
      const userId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const redirectPath = "/settings/linkedin";
      const oauthState = createLinkedInOAuthState({
        userId,
        redirectPath,
        now: 1_700_000_000_000,
      });

      assert.equal(oauthState.state, oauthState.payload.nonce);
      assert.notEqual(oauthState.cookie.value, oauthState.state);

      const decoded = parseLinkedInOAuthState(oauthState.cookie.value);
      assert.ok(decoded);
      assert.equal(decoded?.userId, userId);
      assert.equal(decoded?.redirectPath, redirectPath);
    });

    it("nonce is unique across calls", () => {
      const a = createLinkedInOAuthState({
        userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        redirectPath: "/settings/linkedin",
      });
      const b = createLinkedInOAuthState({
        userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        redirectPath: "/settings/linkedin",
      });
      assert.notEqual(a.state, b.state);
    });
  });
});
