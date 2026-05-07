import test from "node:test";
import assert from "node:assert";
import { checkRateLimit } from "../../../src/lib/security/rate-limit.ts";

const BULK_INVITE_CONFIG = {
  feature: "org-bulk-invite",
  limitPerIp: 5,
  limitPerUser: 3,
};

function makeRequest(ip: string): Request {
  return new Request("https://example.com/api/organizations/org-1/invites/bulk", {
    headers: { "x-forwarded-for": ip },
  });
}

function clearStore() {
  globalThis.__rateLimitStore?.clear();
}

test("bulk invite rate limit: first request is allowed", () => {
  clearStore();

  const result = checkRateLimit(makeRequest("1.1.1.1"), {
    ...BULK_INVITE_CONFIG,
    userId: "user-a",
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.limit, 3); // per-user limit is tighter
  assert.strictEqual(result.remaining, 2);
});

test("bulk invite rate limit: allows up to limitPerUser requests for the same user", () => {
  clearStore();

  const req = makeRequest("2.2.2.2");
  const config = { ...BULK_INVITE_CONFIG, userId: "user-b" };

  for (let i = 0; i < BULK_INVITE_CONFIG.limitPerUser; i++) {
    const result = checkRateLimit(req, config);
    assert.strictEqual(result.ok, true, `request ${i + 1} should be allowed`);
  }
});

test("bulk invite rate limit: exceeding limitPerUser returns ok=false", () => {
  clearStore();

  const req = makeRequest("3.3.3.3");
  const config = { ...BULK_INVITE_CONFIG, userId: "user-c" };

  for (let i = 0; i < BULK_INVITE_CONFIG.limitPerUser; i++) {
    checkRateLimit(req, config);
  }

  const result = checkRateLimit(req, config);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.remaining, 0);
});

test("bulk invite rate limit: exceeded result includes retryAfterSeconds", () => {
  clearStore();

  const req = makeRequest("4.4.4.4");
  const config = { ...BULK_INVITE_CONFIG, userId: "user-d" };

  for (let i = 0; i < BULK_INVITE_CONFIG.limitPerUser; i++) {
    checkRateLimit(req, config);
  }

  const result = checkRateLimit(req, config);
  assert.strictEqual(result.ok, false);
  assert.ok(
    typeof result.retryAfterSeconds === "number" && result.retryAfterSeconds > 0,
    `retryAfterSeconds should be a positive number, got ${result.retryAfterSeconds}`,
  );
});

test("bulk invite rate limit: exceeded result includes Retry-After header", () => {
  clearStore();

  const req = makeRequest("5.5.5.5");
  const config = { ...BULK_INVITE_CONFIG, userId: "user-e" };

  for (let i = 0; i < BULK_INVITE_CONFIG.limitPerUser; i++) {
    checkRateLimit(req, config);
  }

  const result = checkRateLimit(req, config);
  assert.strictEqual(result.ok, false);
  assert.ok("Retry-After" in result.headers, "headers should include Retry-After");
  assert.strictEqual(result.headers["Retry-After"], String(result.retryAfterSeconds));
});

test("bulk invite rate limit: different users share IP limit independently", () => {
  clearStore();

  // Each user has their own per-user bucket. User X exhausts their limit
  // while user Y on the same IP should still be allowed.
  const ip = "6.6.6.6";
  const configX = { ...BULK_INVITE_CONFIG, userId: "user-x" };
  const configY = { ...BULK_INVITE_CONFIG, userId: "user-y" };

  for (let i = 0; i < BULK_INVITE_CONFIG.limitPerUser; i++) {
    checkRateLimit(makeRequest(ip), configX);
  }

  // user-x is now blocked
  const blockedResult = checkRateLimit(makeRequest(ip), configX);
  assert.strictEqual(blockedResult.ok, false);

  // user-y on the same IP still has their own quota
  const allowedResult = checkRateLimit(makeRequest(ip), configY);
  assert.strictEqual(allowedResult.ok, true);
});

test("bulk invite rate limit: allows up to limitPerIp for anonymous requests", () => {
  clearStore();

  const req = makeRequest("7.7.7.7");
  // No userId — only IP bucket applies
  const config = { ...BULK_INVITE_CONFIG, userId: null };

  for (let i = 0; i < BULK_INVITE_CONFIG.limitPerIp; i++) {
    const result = checkRateLimit(req, config);
    assert.strictEqual(result.ok, true, `anonymous request ${i + 1} should be allowed`);
  }

  const result = checkRateLimit(req, config);
  assert.strictEqual(result.ok, false);
  assert.ok(result.retryAfterSeconds > 0);
});

test("bulk invite rate limit: reason string mentions the feature name when blocked", () => {
  clearStore();

  const req = makeRequest("8.8.8.8");
  const config = { ...BULK_INVITE_CONFIG, userId: "user-f" };

  for (let i = 0; i < BULK_INVITE_CONFIG.limitPerUser; i++) {
    checkRateLimit(req, config);
  }

  const result = checkRateLimit(req, config);
  assert.strictEqual(result.ok, false);
  assert.ok(
    result.reason.includes("org-bulk-invite"),
    `reason should mention feature name, got: "${result.reason}"`,
  );
});
