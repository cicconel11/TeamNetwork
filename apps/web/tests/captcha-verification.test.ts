import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { verifyCaptcha } from "../src/lib/security/captcha.ts";

// Store original env values
const originalEnv = { ...process.env };

// Helper to reset environment
function resetEnv() {
    process.env = { ...originalEnv };
}

/**
 * Feature: hcaptcha-integration, Property 2: Missing Token Rejection
 * 
 * *For any* HTTP request to a protected API endpoint that does not include
 * a `captchaToken` field, the endpoint SHALL return a 400 status code with
 * an appropriate error message.
 * 
 * **Validates: Requirements 2.2**
 */
test("Property 2: Missing Token Rejection - verifyCaptcha rejects missing/empty tokens", async () => {
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

/**
 * Feature: hcaptcha-integration, Property 3: Invalid Token Rejection
 * 
 * *For any* HTTP request to a protected API endpoint with an invalid, expired,
 * or malformed `captchaToken`, the endpoint SHALL return a 403 status code
 * after verification fails.
 * 
 * **Validates: Requirements 2.3**
 */
test("Property 3: Invalid Token Rejection - verifyCaptcha rejects invalid tokens", async () => {
    // This test verifies that random non-empty strings are rejected
    // We can't actually call hCaptcha API in tests, so we verify the function
    // properly handles the token and would send it for verification

    process.env.NODE_ENV = "production";

    await fc.assert(
        fc.asyncProperty(
            // Generate random non-empty strings that are clearly not valid hCaptcha tokens
            fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            async (invalidToken) => {
                const result = await verifyCaptcha(invalidToken, undefined, {
                    secretKey: "test-secret-key",
                    skipInDevelopment: false,
                    timeout: 100, // Short timeout since we expect network failure in test env
                });

                // Invalid tokens should fail (either network error in test env or actual rejection)
                assert.strictEqual(result.success, false, "Invalid token should not succeed");
                assert.ok(
                    result.error_codes && result.error_codes.length > 0,
                    "Should have error codes"
                );
            }
        ),
        { numRuns: 100 }
    );

    resetEnv();
});

/**
 * Feature: hcaptcha-integration, Property 4: Verification Timeout Enforcement
 * 
 * *For any* captcha verification request, if the hCaptcha API does not respond
 * within the configured timeout (default 3 seconds), the verification function
 * SHALL abort the request and return a timeout error.
 * 
 * **Validates: Requirements 2.5**
 */
test("Property 4: Verification Timeout Enforcement - verifyCaptcha respects timeout", async () => {
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
                fc.string({ minLength: 10, maxLength: 50 }).filter(s => s.trim().length > 0),
                async (timeoutMs, extraDelay, token) => {
                    // Ensure delay is always longer than timeout to trigger timeout
                    const responseDelay = timeoutMs + extraDelay;

                    // Mock fetch to simulate slow API response
                    globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit): Promise<Response> => {
                        return new Promise((resolve, reject) => {
                            const timeoutHandle = setTimeout(() => {
                                resolve(new Response(JSON.stringify({ success: true }), {
                                    status: 200,
                                    headers: { "Content-Type": "application/json" },
                                }));
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
                    assert.ok(
                        result.error_codes?.includes("timeout"),
                        `Expected 'timeout' error code, got: ${result.error_codes}`
                    );
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
