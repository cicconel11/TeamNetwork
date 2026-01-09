import test from "node:test";
import assert from "node:assert";
import { checkWebhookRateLimit, resetWebhookRateLimitStore } from "../src/lib/security/webhook-rate-limit";

test("webhook rate limiting allows requests under the limit", () => {
  resetWebhookRateLimitStore();
  const ip = "192.168.1.1";

  // First request should be allowed
  const result1 = checkWebhookRateLimit(ip);
  assert.strictEqual(result1.ok, true, "First request should be allowed");
  assert.ok(result1.remaining > 0, "Should have remaining requests");
});

test("webhook rate limiting blocks requests over the limit", () => {
  resetWebhookRateLimitStore();
  const ip = "192.168.1.2";
  const limit = 100; // Default limit per minute

  // Exhaust the rate limit
  for (let i = 0; i < limit; i++) {
    const result = checkWebhookRateLimit(ip);
    assert.strictEqual(result.ok, true, `Request ${i + 1} should be allowed`);
  }

  // Next request should be blocked
  const blocked = checkWebhookRateLimit(ip);
  assert.strictEqual(blocked.ok, false, "Request over limit should be blocked");
  assert.ok(blocked.retryAfterSeconds > 0, "Should have retry-after value");
});

test("webhook rate limiting tracks different IPs separately", () => {
  resetWebhookRateLimitStore();
  const ip1 = "192.168.1.3";
  const ip2 = "192.168.1.4";

  // Make requests from both IPs
  const result1 = checkWebhookRateLimit(ip1);
  const result2 = checkWebhookRateLimit(ip2);

  assert.strictEqual(result1.ok, true);
  assert.strictEqual(result2.ok, true);

  // Both should have same remaining (limit - 1)
  assert.strictEqual(result1.remaining, result2.remaining);
});

test("webhook rate limiting resets after window expires", async () => {
  resetWebhookRateLimitStore();
  const ip = "192.168.1.5";
  const shortWindowMs = 50; // Very short window for testing

  // Make a request with a short window
  const result1 = checkWebhookRateLimit(ip, { windowMs: shortWindowMs, limit: 1 });
  assert.strictEqual(result1.ok, true);

  // Second request should be blocked
  const result2 = checkWebhookRateLimit(ip, { windowMs: shortWindowMs, limit: 1 });
  assert.strictEqual(result2.ok, false);

  // Wait for window to expire
  await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 10));

  // Should be allowed again
  const result3 = checkWebhookRateLimit(ip, { windowMs: shortWindowMs, limit: 1 });
  assert.strictEqual(result3.ok, true, "Should be allowed after window reset");
});

test("webhook rate limiting returns proper headers", () => {
  resetWebhookRateLimitStore();
  const ip = "192.168.1.6";

  const result = checkWebhookRateLimit(ip);

  assert.ok("X-RateLimit-Limit" in result.headers, "Should have limit header");
  assert.ok("X-RateLimit-Remaining" in result.headers, "Should have remaining header");
  assert.ok("X-RateLimit-Reset" in result.headers, "Should have reset header");
});
