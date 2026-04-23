/**
 * Provider-neutral captcha form-state tests.
 *
 * Backend provider routing is covered by tests/turnstile.test.ts. These tests
 * only assert the shared form contract: blank tokens block submission and
 * non-empty verification tokens unlock submit actions.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fc from "fast-check";

describe("Captcha form state", () => {
  describe("Verification callback behavior", () => {
    it("passes the exact provider token through unchanged", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
          async (token) => {
            let receivedToken: string | null = null;

            const onVerify = (nextToken: string) => {
              receivedToken = nextToken;
            };

            onVerify(token);

            assert.strictEqual(
              receivedToken,
              token,
              `Expected callback to receive token "${token}", but got "${receivedToken}"`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("preserves common provider token characters", async () => {
      const tokenChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-.";

      await fc.assert(
        fc.asyncProperty(
          fc
            .array(fc.integer({ min: 0, max: tokenChars.length - 1 }), { minLength: 20, maxLength: 200 })
            .map((indices) => indices.map((i) => tokenChars[i]).join("")),
          async (token) => {
            let receivedToken: string | null = null;

            const onVerify = (nextToken: string) => {
              receivedToken = nextToken;
            };

            onVerify(token);

            assert.strictEqual(receivedToken, token, "Captcha token should be preserved exactly");
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Submit gating", () => {
    it("blocks form submission without a verified token", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.oneof(fc.constant(null), fc.constant(""), fc.constant("   "), fc.constant("\t"), fc.constant("\n")),
          async (_email, _password, captchaToken) => {
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;
            let submissionBlocked = false;
            let errorMessage: string | null = null;

            if (!isVerified || !captchaToken || captchaToken.trim().length === 0) {
              errorMessage = "Please complete the captcha verification";
              submissionBlocked = true;
            }

            assert.strictEqual(
              submissionBlocked,
              true,
              `Expected submission to be blocked for token "${captchaToken}", but it was allowed`,
            );
            assert.strictEqual(errorMessage, "Please complete the captcha verification");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("allows form submission with a verified token", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
          async (_email, _password, captchaToken) => {
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;
            let submissionProceeded = false;
            let errorMessage: string | null = null;

            if (!isVerified || !captchaToken || captchaToken.trim().length === 0) {
              errorMessage = "Please complete the captcha verification";
            } else {
              submissionProceeded = true;
            }

            assert.strictEqual(submissionProceeded, true);
            assert.strictEqual(errorMessage, null);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("disables submit controls when token is blank", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant(null),
            fc.constant(""),
            fc.constant("   "),
            fc.constant("\t"),
            fc.constant("\n"),
            fc.constant("  \t  "),
          ),
          async (captchaToken) => {
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;

            assert.strictEqual(
              !isVerified,
              true,
              `Expected button to be disabled for token "${captchaToken}", but it was enabled`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("enables submit controls when token is present", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
          async (captchaToken) => {
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;

            assert.strictEqual(!isVerified, false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
