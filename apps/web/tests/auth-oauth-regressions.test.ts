import assert from "node:assert";
import { describe, it } from "node:test";

import {
  buildAuthRetryHref,
  shouldResumeSignupRegistration,
} from "../src/lib/auth/signup-flow";
import { buildEmailSignupCallbackUrl } from "../src/lib/auth/redirect";
import { runAgeValidationGate } from "../src/lib/auth/callback-flow";
import { validateSiteUrl } from "../src/lib/supabase/config";
import { createAgeValidationToken } from "../src/lib/auth/age-validation";

const siteUrl = "https://www.myteamnetwork.com";

describe("OAuth auth regression coverage", () => {
  describe("site URL validation", () => {
    it("does not throw for Vercel preview runtime without NEXT_PUBLIC_SITE_URL", () => {
      assert.doesNotThrow(() =>
        validateSiteUrl({
          NODE_ENV: "production",
          VERCEL: "1",
          VERCEL_ENV: "preview",
        } as NodeJS.ProcessEnv)
      );
    });
  });

  describe("signup callback URLs and retry routing", () => {
    it("marks email signup callbacks as signup mode", () => {
      const callbackUrl = buildEmailSignupCallbackUrl(siteUrl, "/app/join?token=abc123");
      const parsed = new URL(callbackUrl);

      assert.strictEqual(parsed.pathname, "/auth/callback");
      assert.strictEqual(parsed.searchParams.get("mode"), "signup");
      assert.strictEqual(parsed.searchParams.get("redirect"), "/app/join?token=abc123");
    });

    it("routes auth errors back to signup for email signup retries", () => {
      assert.strictEqual(
        buildAuthRetryHref("signup", "/app/join?token=abc123"),
        `/auth/signup?redirect=${encodeURIComponent("/app/join?token=abc123")}`
      );
    });
  });

  describe("signup age-gate recovery", () => {
    it("does not resume the registration step after an expired age-token error", () => {
      assert.strictEqual(
        shouldResumeSignupRegistration({
          initialError: "Age verification expired. Please try again.",
          hasStoredAgeGateData: true,
        }),
        false
      );
    });

    it("still resumes the registration step for recoverable non-age errors", () => {
      assert.strictEqual(
        shouldResumeSignupRegistration({
          initialError: "OAuth popup was closed before completing sign in.",
          hasStoredAgeGateData: true,
        }),
        true
      );
    });
  });

  describe("callback age metadata persistence", () => {
    it("fails closed when validated OAuth signup metadata cannot be persisted", async () => {
      process.env.AGE_VALIDATION_SECRET = process.env.AGE_VALIDATION_SECRET ?? "test-secret-32-characters-long!!";
      const ageToken = createAgeValidationToken("18_plus");
      const requestUrl = new URL(
        `${siteUrl}/auth/callback?code=test-code&mode=signup&redirect=%2Fapp&age_bracket=18_plus&age_token=${encodeURIComponent(ageToken)}`
      );

      let cleanupCalled = false;
      const result = await runAgeValidationGate({
        requestUrl,
        siteUrl,
        requestedRedirect: "/app",
        user: {
          id: "oauth-user-1",
          created_at: new Date().toISOString(),
          user_metadata: {},
        },
        persistAgeMetadata: async () => {
          throw new Error("forced failure");
        },
        cleanupUnvalidatedSignup: async () => {
          cleanupCalled = true;
        },
      });

      assert.strictEqual(result.kind, "redirect");
      assert.strictEqual(cleanupCalled, true);
      assert.ok(result.location.includes("/auth/signup?error="));
      const parsed = new URL(result.location);
      assert.strictEqual(
        parsed.searchParams.get("error"),
        "We couldn't complete age verification. Please try again.",
        "Should send the user back through signup instead of allowing an unvalidated account through"
      );
    });
  });

  describe("first-time OAuth login routing", () => {
    it("allows a brand-new OAuth login callback when the flow is login, not signup", async () => {
      const requestUrl = new URL(
        `${siteUrl}/auth/callback?code=test-code&mode=login&redirect=%2Fapp%2Fjoin`
      );

      const result = await runAgeValidationGate({
        requestUrl,
        siteUrl,
        requestedRedirect: "/app/join",
        user: {
          id: "oauth-user-login-1",
          created_at: new Date().toISOString(),
          user_metadata: {},
        },
      });

      assert.deepStrictEqual(result, { kind: "allow" });
    });

    it("still blocks a brand-new OAuth signup callback without age metadata", async () => {
      const requestUrl = new URL(
        `${siteUrl}/auth/callback?code=test-code&mode=signup&redirect=%2Fapp%2Fjoin`
      );

      const result = await runAgeValidationGate({
        requestUrl,
        siteUrl,
        requestedRedirect: "/app/join",
        user: {
          id: "oauth-user-signup-1",
          created_at: new Date().toISOString(),
          user_metadata: {},
        },
      });

      assert.strictEqual(result.kind, "redirect");
      if (result.kind === "redirect") {
        const parsed = new URL(result.location);
        assert.strictEqual(parsed.pathname, "/auth/signup");
        assert.strictEqual(parsed.searchParams.get("redirect"), "/app/join");
      }
    });
  });
});
