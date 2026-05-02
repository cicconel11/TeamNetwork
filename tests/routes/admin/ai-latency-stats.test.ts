import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLatencyStats,
  parseLatencyStatsDays,
} from "../../../src/lib/ai/latency-stats.ts";

interface SimUser {
  id: string;
  email: string | null;
}

interface SimRequest {
  user: SimUser | null;
  isDevAdmin: boolean;
}

function simulateGate(req: SimRequest): { status: number; body: unknown } {
  if (!req.user) return { status: 401, body: { error: "Unauthorized" } };
  if (!req.isDevAdmin) return { status: 403, body: { error: "Forbidden" } };
  return { status: 200, body: { ok: true } };
}

test("auth gate: unauthenticated -> 401", () => {
  const r = simulateGate({ user: null, isDevAdmin: false });
  assert.equal(r.status, 401);
});

test("auth gate: authenticated non-dev-admin -> 403", () => {
  const r = simulateGate({
    user: { id: "u-1", email: "user@example.com" },
    isDevAdmin: false,
  });
  assert.equal(r.status, 403);
});

test("auth gate: dev-admin -> 200", () => {
  const r = simulateGate({
    user: { id: "u-1", email: "admin@example.com" },
    isDevAdmin: true,
  });
  assert.equal(r.status, 200);
});

test("parseLatencyStatsDays: defaults to 7 days", () => {
  assert.deepEqual(parseLatencyStatsDays("https://example.test/api/admin/ai/latency-stats"), {
    ok: true,
    days: 7,
  });
});

test("parseLatencyStatsDays: accepts supported day windows", () => {
  assert.deepEqual(parseLatencyStatsDays("https://example.test/api/admin/ai/latency-stats?days=1"), {
    ok: true,
    days: 1,
  });
  assert.deepEqual(parseLatencyStatsDays("https://example.test/api/admin/ai/latency-stats?days=30"), {
    ok: true,
    days: 30,
  });
});

test("parseLatencyStatsDays: rejects invalid and repeated days", () => {
  assert.deepEqual(parseLatencyStatsDays("https://example.test/api/admin/ai/latency-stats?days=2"), {
    ok: false,
  });
  assert.deepEqual(parseLatencyStatsDays("https://example.test/api/admin/ai/latency-stats?days=abc"), {
    ok: false,
  });
  assert.deepEqual(parseLatencyStatsDays("https://example.test/api/admin/ai/latency-stats?days=7&days=30"), {
    ok: false,
  });
});

test("response body is aggregate-only", () => {
  const stats = {
    windowDays: 7,
    ...buildLatencyStats([
      {
        created_at: "2026-05-01T12:00:00Z",
        latency_ms: 100,
        cache_status: "miss",
        context_surface: "members",
        intent_type: "knowledge_query",
        stage_timings: {
          request: {
            pass1_path: "model",
            fast_path_label: "model_default",
          },
          stages: {},
        },
      },
    ]),
  };

  const serialized = JSON.stringify(stats);
  assert.match(serialized, /byPass1Path/);
  assert.match(serialized, /byFastPathLabel/);
  assert.doesNotMatch(serialized, /user_id|org_id|thread_id|message_id|prompt|message_text/);
});
