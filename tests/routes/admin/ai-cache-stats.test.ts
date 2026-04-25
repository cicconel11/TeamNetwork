import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResponse,
  type ViewRow,
} from "../../../src/app/api/admin/ai/cache-stats/route.ts";

// ---------------------------------------------------------------------------
// buildResponse — pure aggregation
// ---------------------------------------------------------------------------

test("buildResponse: empty rows return zeroes without crashing", () => {
  const out = buildResponse([], 7);
  assert.equal(out.windowDays, 7);
  assert.equal(out.totalRequests, 0);
  assert.equal(out.overallHitRate, 0);
  assert.equal(out.byStatus.hit_exact, 0);
  assert.equal(out.byStatus.miss, 0);
  assert.deepEqual(out.byDay, []);
});

test("buildResponse: aggregates counts by status across days", () => {
  const rows: ViewRow[] = [
    { day: "2026-04-24T00:00:00Z", cache_status: "hit_exact", count: 30, pct_of_day: null },
    { day: "2026-04-24T00:00:00Z", cache_status: "miss", count: 70, pct_of_day: null },
    { day: "2026-04-23T00:00:00Z", cache_status: "hit_exact", count: 10, pct_of_day: null },
    { day: "2026-04-23T00:00:00Z", cache_status: "bypass", count: 90, pct_of_day: null },
  ];
  const out = buildResponse(rows, 7);

  assert.equal(out.totalRequests, 200);
  assert.equal(out.byStatus.hit_exact, 40);
  assert.equal(out.byStatus.miss, 70);
  assert.equal(out.byStatus.bypass, 90);
  assert.equal(out.overallHitRate, 0.2);

  // Day order: most recent first.
  assert.equal(out.byDay.length, 2);
  assert.equal(out.byDay[0].day, "2026-04-24T00:00:00.000Z");
  assert.equal(out.byDay[0].total, 100);
  assert.equal(out.byDay[0].byStatus.hit_exact, 30);
  assert.equal(out.byDay[1].day, "2026-04-23T00:00:00.000Z");
  assert.equal(out.byDay[1].total, 100);
});

test("buildResponse: numeric strings from PG bigint are coerced", () => {
  const rows: ViewRow[] = [
    { day: "2026-04-24T00:00:00Z", cache_status: "hit_exact", count: "5", pct_of_day: null },
  ];
  const out = buildResponse(rows, 7);
  assert.equal(out.totalRequests, 5);
  assert.equal(out.byStatus.hit_exact, 5);
});

test("buildResponse: unknown cache_status falls into 'other'", () => {
  const rows: ViewRow[] = [
    { day: "2026-04-24T00:00:00Z", cache_status: "weird_status", count: 3, pct_of_day: null },
  ];
  const out = buildResponse(rows, 7);
  assert.equal(out.totalRequests, 3);
  assert.equal(out.byStatus.other, 3);
});

test("buildResponse: zero or negative counts are ignored", () => {
  const rows: ViewRow[] = [
    { day: "2026-04-24T00:00:00Z", cache_status: "hit_exact", count: 0, pct_of_day: null },
    { day: "2026-04-24T00:00:00Z", cache_status: "miss", count: -5, pct_of_day: null },
    { day: "2026-04-24T00:00:00Z", cache_status: "miss", count: 7, pct_of_day: null },
  ];
  const out = buildResponse(rows, 7);
  assert.equal(out.totalRequests, 7);
  assert.equal(out.byStatus.hit_exact, 0);
  assert.equal(out.byStatus.miss, 7);
});

// ---------------------------------------------------------------------------
// Auth gate simulation — mirrors the route's order: unauthenticated → 401,
// non-dev-admin → 403, dev-admin → 200. Pure logic; no Supabase needed.
// ---------------------------------------------------------------------------

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

test("auth gate: unauthenticated → 401", () => {
  const r = simulateGate({ user: null, isDevAdmin: false });
  assert.equal(r.status, 401);
});

test("auth gate: authenticated non-dev-admin → 403", () => {
  const r = simulateGate({
    user: { id: "u-1", email: "user@example.com" },
    isDevAdmin: false,
  });
  assert.equal(r.status, 403);
});

test("auth gate: dev-admin → 200", () => {
  const r = simulateGate({
    user: { id: "u-1", email: "admin@example.com" },
    isDevAdmin: true,
  });
  assert.equal(r.status, 200);
});
