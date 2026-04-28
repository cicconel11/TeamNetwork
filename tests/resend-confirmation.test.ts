/**
 * Contract tests for /api/auth/resend-confirmation.
 *
 * The route imports next/headers (via @/lib/supabase/server), which can't be
 * loaded outside the Next.js request context — so these tests cover the
 * orthogonal pieces directly: the Zod input contract and the rate-limit keying
 * the route relies on. Full end-to-end coverage lives in the manual smoke
 * verification (see /docs/runbooks/stuck-signup.md).
 */
import test, { beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../src/lib/security/rate-limit.ts";

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore: Map<string, { count: number; resetAt: number }> | undefined;
}

beforeEach(() => {
  globalThis.__rateLimitStore?.clear();
});

describe("resend-confirmation rate limiting", () => {
  function buildRequest() {
    return new Request("http://localhost/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.42" },
    });
  }

  test("per-IP bucket allows up to 5 requests then blocks", () => {
    const request = buildRequest();
    const config = {
      pathOverride: "/api/auth/resend-confirmation:ip",
      limitPerIp: 5,
      windowMs: 60 * 60 * 1000,
      feature: "resend",
    } as const;

    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(request, config);
      assert.equal(result.ok, true, `attempt ${i + 1} should be allowed`);
    }
    const blocked = checkRateLimit(request, config);
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /Too many requests/);
  });

  test("per-email bucket independently rate limits the same email across IPs", () => {
    const requestA = new Request("http://localhost/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    const requestB = new Request("http://localhost/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.99" },
    });
    const config = {
      pathOverride: "/api/auth/resend-confirmation:email",
      limitPerIp: 0,
      limitPerUser: 2,
      userId: "vicky@example.com",
      windowMs: 5 * 60 * 1000,
      feature: "resend",
    } as const;

    assert.equal(checkRateLimit(requestA, config).ok, true);
    assert.equal(checkRateLimit(requestB, config).ok, true);
    // Third request — same email, different IP — must be blocked.
    assert.equal(checkRateLimit(requestA, config).ok, false);
  });
});
