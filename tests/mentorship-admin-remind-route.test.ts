import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/mentorship/admin/remind/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ── Static invariants ────────────────────────────────────────────────────────

test("route exports POST", () => {
  assert.match(routeSource, /export async function POST/);
});

test("route is dynamic + nodejs runtime", () => {
  assert.match(routeSource, /export const dynamic = "force-dynamic"/);
  assert.match(routeSource, /export const runtime = "nodejs"/);
});

test("route requires admin role with active status", () => {
  assert.match(routeSource, /role\?.role !== "admin"/);
  assert.match(routeSource, /role\?.status !== "active"/);
});

test("route enforces 24h rate-limit window", () => {
  assert.match(routeSource, /24 \* 60 \* 60 \* 1000/);
  assert.match(routeSource, /mentorship_reminders/);
});

test("route rate-limits before auth and service work", () => {
  assert.match(routeSource, /checkRateLimit\(req/);
  assert.match(routeSource, /buildRateLimitResponse\(ipRateLimit\)/);
  assert.match(routeSource, /feature: "mentorship proposal reminders"/);
  assert.ok(
    routeSource.indexOf("checkRateLimit(req") < routeSource.indexOf("createClient()"),
    "IP rate limit should run before auth client creation"
  );
  assert.ok(
    routeSource.indexOf("userRateLimit") < routeSource.indexOf("createServiceClient()"),
    "user rate limit should run before service client work"
  );
});

test("route includes rate-limit headers on handled responses", () => {
  assert.match(routeSource, /headers: ipRateLimit\.headers/);
  assert.match(routeSource, /headers: userRateLimit\.headers/);
  assert.match(routeSource, /NextResponse\.json\(\{ sent, skipped \}, \{ headers: userRateLimit\.headers \}\)/);
});

test("route validates body with Zod", () => {
  assert.match(routeSource, /BodySchema\.parse/);
  assert.match(routeSource, /mentor_user_id: baseSchemas\.uuid\.optional/);
  assert.match(routeSource, /min_pending: z\.number\(\)/);
});

test("route calls sendNotificationBlast with mentorship category", () => {
  assert.match(routeSource, /sendNotificationBlast/);
  assert.match(routeSource, /proposalReminderTemplate/);
});

// ── Simulator ────────────────────────────────────────────────────────────────

type Role = "admin" | "active_member" | "alumni" | "parent";
type Status = "active" | "revoked" | "pending";

interface PendingPair {
  mentor_user_id: string;
  status: "proposed";
}

interface ReminderLog {
  mentor_user_id: string;
  created_at: number; // ms
}

interface SimReq {
  authUserId: string | null;
  orgId: string;
  caller: { role: Role; status: Status } | null;
  body: { mentor_user_id?: string; min_pending?: number } | null;
  pendingPairs: PendingPair[];
  reminderLog: ReminderLog[];
  now: number;
}

interface SimRes {
  status: number;
  sent: Array<{ mentor_user_id: string; pending_count: number }>;
  skipped: Array<{ mentor_user_id: string; reason: string }>;
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function simulate(req: SimReq): SimRes {
  if (!UUID.test(req.orgId)) {
    return { status: 400, sent: [], skipped: [], error: "Invalid organization id" };
  }
  if (!req.authUserId) {
    return { status: 401, sent: [], skipped: [], error: "Unauthorized" };
  }
  if (!req.caller || req.caller.role !== "admin" || req.caller.status !== "active") {
    return { status: 403, sent: [], skipped: [], error: "Forbidden" };
  }
  if (!req.body || (!req.body.mentor_user_id && !req.body.min_pending)) {
    return {
      status: 400,
      sent: [],
      skipped: [],
      error: "Provide mentor_user_id or min_pending",
    };
  }

  const pendingByMentor = new Map<string, number>();
  for (const p of req.pendingPairs) {
    pendingByMentor.set(p.mentor_user_id, (pendingByMentor.get(p.mentor_user_id) ?? 0) + 1);
  }

  const candidates = req.body.mentor_user_id
    ? [req.body.mentor_user_id]
    : Array.from(pendingByMentor.entries())
        .filter(([, c]) => c >= (req.body!.min_pending ?? 1))
        .map(([m]) => m);

  const rateLimited = new Set(
    req.reminderLog
      .filter((r) => req.now - r.created_at < WINDOW_MS)
      .map((r) => r.mentor_user_id)
  );

  const sent: SimRes["sent"] = [];
  const skipped: SimRes["skipped"] = [];
  for (const m of candidates) {
    const count = pendingByMentor.get(m) ?? 0;
    if (count <= 0) {
      skipped.push({ mentor_user_id: m, reason: "no_pending" });
      continue;
    }
    if (rateLimited.has(m)) {
      skipped.push({ mentor_user_id: m, reason: "rate_limited" });
      continue;
    }
    sent.push({ mentor_user_id: m, pending_count: count });
  }

  return { status: 200, sent, skipped };
}

// ── Scenarios ────────────────────────────────────────────────────────────────

const ORG = randomUUID();
const ADMIN = randomUUID();
const MENTOR_A = randomUUID();
const MENTOR_B = randomUUID();
const MENTOR_ZERO = randomUUID();

test("non-admin caller → 403", () => {
  const res = simulate({
    authUserId: ADMIN,
    orgId: ORG,
    caller: { role: "active_member", status: "active" },
    body: { mentor_user_id: MENTOR_A },
    pendingPairs: [{ mentor_user_id: MENTOR_A, status: "proposed" }],
    reminderLog: [],
    now: Date.now(),
  });
  assert.equal(res.status, 403);
});

test("admin + mentor_user_id with pending → sends one reminder", () => {
  const res = simulate({
    authUserId: ADMIN,
    orgId: ORG,
    caller: { role: "admin", status: "active" },
    body: { mentor_user_id: MENTOR_A },
    pendingPairs: [{ mentor_user_id: MENTOR_A, status: "proposed" }],
    reminderLog: [],
    now: Date.now(),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.sent, [{ mentor_user_id: MENTOR_A, pending_count: 1 }]);
  assert.equal(res.skipped.length, 0);
});

test("second call within 24h → skipped rate_limited", () => {
  const now = Date.now();
  const res = simulate({
    authUserId: ADMIN,
    orgId: ORG,
    caller: { role: "admin", status: "active" },
    body: { mentor_user_id: MENTOR_A },
    pendingPairs: [{ mentor_user_id: MENTOR_A, status: "proposed" }],
    reminderLog: [{ mentor_user_id: MENTOR_A, created_at: now - 1_000 }],
    now,
  });
  assert.equal(res.sent.length, 0);
  assert.deepEqual(res.skipped, [{ mentor_user_id: MENTOR_A, reason: "rate_limited" }]);
});

test("reminder older than 24h no longer blocks", () => {
  const now = Date.now();
  const res = simulate({
    authUserId: ADMIN,
    orgId: ORG,
    caller: { role: "admin", status: "active" },
    body: { mentor_user_id: MENTOR_A },
    pendingPairs: [{ mentor_user_id: MENTOR_A, status: "proposed" }],
    reminderLog: [{ mentor_user_id: MENTOR_A, created_at: now - WINDOW_MS - 1 }],
    now,
  });
  assert.deepEqual(res.sent, [{ mentor_user_id: MENTOR_A, pending_count: 1 }]);
});

test("bulk min_pending=1 → sends to each mentor with ≥1 pending, dedupes rate-limited", () => {
  const now = Date.now();
  const res = simulate({
    authUserId: ADMIN,
    orgId: ORG,
    caller: { role: "admin", status: "active" },
    body: { min_pending: 1 },
    pendingPairs: [
      { mentor_user_id: MENTOR_A, status: "proposed" },
      { mentor_user_id: MENTOR_A, status: "proposed" },
      { mentor_user_id: MENTOR_B, status: "proposed" },
    ],
    reminderLog: [{ mentor_user_id: MENTOR_B, created_at: now - 1_000 }],
    now,
  });
  assert.deepEqual(
    res.sent.sort((x, y) => x.mentor_user_id.localeCompare(y.mentor_user_id)),
    [{ mentor_user_id: MENTOR_A, pending_count: 2 }]
      .sort((x, y) => x.mentor_user_id.localeCompare(y.mentor_user_id))
  );
  assert.deepEqual(res.skipped, [{ mentor_user_id: MENTOR_B, reason: "rate_limited" }]);
});

test("mentor with 0 pending is not in send list", () => {
  const res = simulate({
    authUserId: ADMIN,
    orgId: ORG,
    caller: { role: "admin", status: "active" },
    body: { mentor_user_id: MENTOR_ZERO },
    pendingPairs: [{ mentor_user_id: MENTOR_A, status: "proposed" }],
    reminderLog: [],
    now: Date.now(),
  });
  assert.equal(res.sent.length, 0);
  assert.deepEqual(res.skipped, [{ mentor_user_id: MENTOR_ZERO, reason: "no_pending" }]);
});

test("bulk with min_pending=2 excludes mentors with only 1 pending", () => {
  const res = simulate({
    authUserId: ADMIN,
    orgId: ORG,
    caller: { role: "admin", status: "active" },
    body: { min_pending: 2 },
    pendingPairs: [
      { mentor_user_id: MENTOR_A, status: "proposed" },
      { mentor_user_id: MENTOR_B, status: "proposed" },
      { mentor_user_id: MENTOR_B, status: "proposed" },
    ],
    reminderLog: [],
    now: Date.now(),
  });
  assert.deepEqual(res.sent, [{ mentor_user_id: MENTOR_B, pending_count: 2 }]);
  assert.equal(res.skipped.length, 0);
});
