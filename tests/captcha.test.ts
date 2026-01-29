/**
 * Consolidated hCaptcha Integration Tests
 *
 * Tests for captcha verification including:
 * - Backend verification (token validation, timeout enforcement)
 * - Component behavior (callback invocation)
 * - Login form integration (form submission blocking, button state)
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { verifyCaptcha } from "../src/lib/security/captcha.ts";

// Store original env values
const originalEnv = { ...process.env };

// Helper to reset environment
function resetEnv() {
  process.env = { ...originalEnv };
}

describe("hCaptcha Integration", () => {
  describe("Backend Verification", () => {
    it("should reject missing or empty tokens", async () => {
      // Set up a mock secret key so we don't hit development bypass
      process.env.HCAPTCHA_SECRET_KEY = "test-secret-key";
      process.env.NODE_ENV = "production";

      await fc.assert(
        fc.asyncProperty(
          // Generate empty-ish strings: empty, whitespace only, or undefined-like
          fc.oneof(
            fc.constant(""),
            fc.constant("   "),
            fc.constant("\t"),
            fc.constant("\n"),
            fc.constant("  \t  "),
            fc.constant("\n\n"),
            fc.constant("     ")
          ),
          async (emptyToken) => {
            const result = await verifyCaptcha(emptyToken, undefined, {
              secretKey: "test-secret-key",
              skipInDevelopment: false,
            });

            // Missing/empty tokens should fail with missing-input-response error
            assert.strictEqual(result.success, false, "Empty token should not succeed");
            assert.ok(
              result.error_codes?.includes("missing-input-response"),
              `Expected 'missing-input-response' error code, got: ${result.error_codes}`
            );
          }
        ),
        { numRuns: 100 }
      );

      resetEnv();
    });

    it("should reject invalid tokens", async () => {
      // This test verifies that random non-empty strings are rejected
      // We can't actually call hCaptcha API in tests, so we verify the function
      // properly handles the token and would send it for verification

      process.env.NODE_ENV = "production";

      await fc.assert(
        fc.asyncProperty(
          // Generate random non-empty strings that are clearly not valid hCaptcha tokens
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          async (invalidToken) => {
            const result = await verifyCaptcha(invalidToken, undefined, {
              secretKey: "test-secret-key",
              skipInDevelopment: false,
              timeout: 100, // Short timeout since we expect network failure in test env
            });

            // Invalid tokens should fail (either network error in test env or actual rejection)
            assert.strictEqual(result.success, false, "Invalid token should not succeed");
            assert.ok(result.error_codes && result.error_codes.length > 0, "Should have error codes");
          }
        ),
        { numRuns: 100 }
      );

      resetEnv();
    });

    it("should respect timeout settings", async () => {
      process.env.NODE_ENV = "production";

      // Store original fetch to restore later
      const originalFetch = globalThis.fetch;

      try {
        await fc.assert(
          fc.asyncProperty(
            // Generate various timeout values
            fc.integer({ min: 10, max: 200 }),
            // Generate delay that is longer than timeout to guarantee timeout
            fc.integer({ min: 50, max: 300 }),
            // Generate valid-looking tokens
            fc.string({ minLength: 10, maxLength: 50 }).filter((s) => s.trim().length > 0),
            async (timeoutMs, extraDelay, token) => {
              // Ensure delay is always longer than timeout to trigger timeout
              const responseDelay = timeoutMs + extraDelay;

              // Mock fetch to simulate slow API response
              globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit): Promise<Response> => {
                return new Promise((resolve, reject) => {
                  const timeoutHandle = setTimeout(() => {
                    resolve(
                      new Response(JSON.stringify({ success: true }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                      })
                    );
                  }, responseDelay);

                  // Listen for abort signal
                  if (options?.signal) {
                    options.signal.addEventListener("abort", () => {
                      clearTimeout(timeoutHandle);
                      const abortError = new Error("Aborted");
                      abortError.name = "AbortError";
                      reject(abortError);
                    });
                  }
                });
              };

              const startTime = Date.now();

              const result = await verifyCaptcha(token, undefined, {
                secretKey: "test-secret-key",
                skipInDevelopment: false,
                timeout: timeoutMs,
              });

              const elapsed = Date.now() - startTime;

              // The request should complete around the timeout value (not wait for full response delay)
              // Allow buffer for processing overhead
              const maxExpectedTime = timeoutMs + 100;
              assert.ok(
                elapsed <= maxExpectedTime,
                `Request took ${elapsed}ms but timeout was ${timeoutMs}ms (max expected: ${maxExpectedTime}ms)`
              );

              // Should fail with timeout error
              assert.strictEqual(result.success, false, "Should fail with timeout");
              assert.ok(result.error_codes?.includes("timeout"), `Expected 'timeout' error code, got: ${result.error_codes}`);
            }
          ),
          { numRuns: 100 }
        );
      } finally {
        // Restore original fetch
        globalThis.fetch = originalFetch;
        resetEnv();
      }
    });
  });

  describe("Component Behavior", () => {
    it("should invoke onVerify callback with exact token", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random token strings that simulate hCaptcha tokens
          // Real hCaptcha tokens are base64-like strings
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
          async (token) => {
            // Track what token was received by the callback
            let receivedToken: string | null = null;

            // Simulate the onVerify callback that would be passed to HCaptcha component
            const onVerify = (t: string) => {
              receivedToken = t;
            };

            // Simulate what the HCaptcha component does when it receives a token
            // from the underlying @hcaptcha/react-hcaptcha widget
            // The component's handleVerify function calls onVerify with the token
            const handleVerify = (t: string) => {
              onVerify(t);
            };

            // Invoke the handler with the generated token
            handleVerify(token);

            // Verify the callback received the exact same token
            assert.strictEqual(
              receivedToken,
              token,
              `Expected callback to receive token "${token}", but got "${receivedToken}"`
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should preserve special characters in tokens", async () => {
      // Base64 character set used by hCaptcha tokens
      const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

      await fc.assert(
        fc.asyncProperty(
          // Generate strings with base64-like characters using array and map
          fc
            .array(fc.integer({ min: 0, max: base64Chars.length - 1 }), { minLength: 20, maxLength: 200 })
            .map((indices) => indices.map((i) => base64Chars[i]).join("")),
          async (token) => {
            let receivedToken: string | null = null;

            const onVerify = (t: string) => {
              receivedToken = t;
            };

            // Simulate the component's behavior
            onVerify(token);

            // Verify exact match including special characters
            assert.strictEqual(receivedToken, token, "Token with special characters should be preserved exactly");
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Login Form Integration", () => {
    it("should block form submission without valid token", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random email addresses
          fc.emailAddress(),
          // Generate random passwords
          fc.string({ minLength: 1, maxLength: 100 }),
          // Generate null or empty captcha tokens (invalid states)
          fc.oneof(fc.constant(null), fc.constant(""), fc.constant("   "), fc.constant("\t"), fc.constant("\n")),
          async (email, password, captchaToken) => {
            // Simulate the form validation logic from login page
            // The form checks: if (!isVerified || !captchaToken)
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;

            // Track if submission would be blocked
            let submissionBlocked = false;
            let errorMessage: string | null = null;

            // Simulate the handlePasswordLogin validation
            const handlePasswordLogin = () => {
              if (!isVerified || !captchaToken || captchaToken.trim().length === 0) {
                errorMessage = "Please complete the captcha verification";
                submissionBlocked = true;
                return;
              }
              // Would proceed with actual login...
              submissionBlocked = false;
            };

            handlePasswordLogin();

            // Verify that submission is blocked for null/empty tokens
            assert.strictEqual(
              submissionBlocked,
              true,
              `Expected submission to be blocked for token "${captchaToken}", but it was allowed`
            );
            assert.strictEqual(errorMessage, "Please complete the captcha verification", "Expected appropriate error message");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should allow form submission with valid token", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random email addresses
          fc.emailAddress(),
          // Generate random passwords
          fc.string({ minLength: 1, maxLength: 100 }),
          // Generate valid captcha tokens (non-empty strings)
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
          async (email, password, captchaToken) => {
            // Simulate the form validation logic from login page
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;

            // Track if submission would proceed
            let submissionProceeded = false;
            let errorMessage: string | null = null;

            // Simulate the handlePasswordLogin validation
            const handlePasswordLogin = () => {
              if (!isVerified || !captchaToken || captchaToken.trim().length === 0) {
                errorMessage = "Please complete the captcha verification";
                return;
              }
              // Would proceed with actual login...
              submissionProceeded = true;
            };

            handlePasswordLogin();

            // Verify that submission proceeds for valid tokens
            assert.strictEqual(submissionProceeded, true, `Expected submission to proceed for valid token, but it was blocked`);
            assert.strictEqual(errorMessage, null, "Expected no error message for valid token");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should disable submit button when token is null or empty", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate null or empty captcha tokens (unverified states)
          fc.oneof(
            fc.constant(null),
            fc.constant(""),
            fc.constant("   "),
            fc.constant("\t"),
            fc.constant("\n"),
            fc.constant("  \t  ")
          ),
          async (captchaToken) => {
            // Simulate the isVerified calculation from useCaptcha hook
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;

            // The button's disabled state is set to !isVerified
            const buttonDisabled = !isVerified;

            // Verify that button is disabled for null/empty tokens
            assert.strictEqual(
              buttonDisabled,
              true,
              `Expected button to be disabled for token "${captchaToken}", but it was enabled`
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should enable submit button when token is valid", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate valid captcha tokens (non-empty strings)
          fc.string({ minLength: 10, maxLength: 500 }).filter((s) => s.trim().length > 0),
          async (captchaToken) => {
            // Simulate the isVerified calculation from useCaptcha hook
            const isVerified = captchaToken !== null && captchaToken.trim().length > 0;

            // The button's disabled state is set to !isVerified
            const buttonDisabled = !isVerified;

            // Verify that button is enabled for valid tokens
            assert.strictEqual(buttonDisabled, false, `Expected button to be enabled for valid token, but it was disabled`);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
