import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../src/lib/security/rate-limit.ts";

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore: Map<string, { count: number; resetAt: number }> | undefined;
}

function buildRequest() {
  return new Request("http://localhost/api/ai/org-1/chat", {
    headers: {
      "x-forwarded-for": "203.0.113.10",
    },
  });
}

beforeEach(() => {
  globalThis.__rateLimitStore?.clear();
});

test("checkRateLimit enforces the per-org bucket independently of user and IP limits", () => {
  const request = buildRequest();

  const first = checkRateLimit(request, {
    orgId: "org-1",
    userId: "user-1",
    limitPerIp: 100,
    limitPerUser: 100,
    limitPerOrg: 2,
    feature: "ai-chat",
  });
  const second = checkRateLimit(request, {
    orgId: "org-1",
    userId: "user-2",
    limitPerIp: 100,
    limitPerUser: 100,
    limitPerOrg: 2,
    feature: "ai-chat",
  });
  const third = checkRateLimit(request, {
    orgId: "org-1",
    userId: "user-3",
    limitPerIp: 100,
    limitPerUser: 100,
    limitPerOrg: 2,
    feature: "ai-chat",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.match(third.reason, /Too many requests/);
});
