import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/alumni/[alumniId]/enrichment-retry/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ── Source assertions ───────────────────────────────────────────────────────

test("route exports POST", () => {
  assert.match(routeSource, /export async function POST/);
});

test("route rate-limits retries at the right feature + per-user limit", () => {
  assert.match(routeSource, /checkRateLimit/);
  assert.match(routeSource, /feature: "alumni enrichment retry"/);
  assert.match(routeSource, /limitPerUser: 5/);
});

test("route resets the exact enrichment triple from the linkedin-url route", () => {
  assert.match(routeSource, /enrichment_status: "pending"/);
  assert.match(routeSource, /enrichment_retry_count: 0/);
  assert.match(routeSource, /enrichment_error: null/);
});

test("route never reads or echoes the stored enrichment_error", () => {
  // The only allowed appearance of enrichment_error is the reset write.
  const all = routeSource.match(/enrichment_error/g) ?? [];
  const resetWrites = routeSource.match(/enrichment_error: null/g) ?? [];
  assert.equal(all.length, resetWrites.length);
  // The alumni select must not pull the error column.
  assert.match(routeSource, /select\("id, user_id, linkedin_url"\)/);
});

test("route allows the linked self (not admin-only like linkedin-url)", () => {
  assert.match(routeSource, /alumni\.user_id && alumni\.user_id === user\.id/);
  assert.match(routeSource, /!isAdmin && !isSelf/);
});

test("route excludes soft-deleted rows and 409s on missing linkedin_url", () => {
  assert.match(routeSource, /\.is\("deleted_at", null\)/);
  assert.match(routeSource, /No LinkedIn URL on file/);
});

test("route responds 200 with ok + pending status", () => {
  assert.match(routeSource, /\{ ok: true, status: "pending" \}/);
});

// ── Route logic simulator ───────────────────────────────────────────────────

type Role = "admin" | "active_member" | "alumni" | "parent";

interface SimAlumniRow {
  id: string;
  user_id: string | null;
  linkedin_url: string | null;
  deleted_at: string | null;
  enrichment_status: "pending" | "enriched" | "failed" | null;
  enrichment_retry_count: number;
  enrichment_error: string | null;
}

interface SimReq {
  authUserId: string | null;
  organizationId: string;
  alumniId: string;
  membership: { role: Role } | null;
  alumni: SimAlumniRow | null;
}

interface SimRes {
  status: number;
  body: Record<string, unknown>;
  row?: SimAlumniRow;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function simulate(req: SimReq): SimRes {
  if (!UUID.test(req.organizationId) || !UUID.test(req.alumniId)) {
    return { status: 400, body: { error: "Invalid identifier" } };
  }
  if (!req.authUserId) return { status: 401, body: { error: "Unauthorized" } };
  if (!req.membership) return { status: 403, body: { error: "Forbidden" } };

  // Soft-deleted rows are filtered out by the query → 404
  const alumni = req.alumni && req.alumni.deleted_at === null ? req.alumni : null;
  if (!alumni) return { status: 404, body: { error: "Alumni not found" } };

  const isAdmin = req.membership.role === "admin";
  const isSelf = Boolean(alumni.user_id && alumni.user_id === req.authUserId);
  if (!isAdmin && !isSelf) return { status: 403, body: { error: "Forbidden" } };

  if (!alumni.linkedin_url) {
    return { status: 409, body: { error: "No LinkedIn URL on file" } };
  }

  const row: SimAlumniRow = {
    ...alumni,
    enrichment_status: "pending",
    enrichment_retry_count: 0,
    enrichment_error: null,
  };
  return { status: 200, body: { ok: true, status: "pending" }, row };
}

function failedRow(overrides: Partial<SimAlumniRow> = {}): SimAlumniRow {
  return {
    id: randomUUID(),
    user_id: null,
    linkedin_url: "https://www.linkedin.com/in/example",
    deleted_at: null,
    enrichment_status: "failed",
    enrichment_retry_count: 3,
    enrichment_error: "Apify run failed: some internal detail",
    ...overrides,
  };
}

test("admin retry resets the row to the pending triple", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    membership: { role: "admin" },
    alumni: failedRow(),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, status: "pending" });
  assert.equal(res.row?.enrichment_status, "pending");
  assert.equal(res.row?.enrichment_retry_count, 0);
  assert.equal(res.row?.enrichment_error, null);
});

test("linked self may retry their own row", () => {
  const userId = randomUUID();
  const res = simulate({
    authUserId: userId,
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    membership: { role: "alumni" },
    alumni: failedRow({ user_id: userId }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.row?.enrichment_status, "pending");
});

test("unrelated active member is forbidden", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    membership: { role: "active_member" },
    alumni: failedRow({ user_id: randomUUID() }),
  });
  assert.equal(res.status, 403);
});

test("non-member is forbidden before any alumni lookup", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    membership: null,
    alumni: failedRow(),
  });
  assert.equal(res.status, 403);
});

test("missing linkedin_url yields 409 with the documented error", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    membership: { role: "admin" },
    alumni: failedRow({ linkedin_url: null }),
  });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "No LinkedIn URL on file" });
});

test("soft-deleted alumni yields 404", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    membership: { role: "admin" },
    alumni: failedRow({ deleted_at: new Date().toISOString() }),
  });
  assert.equal(res.status, 404);
});

test("invalid identifiers yield 400", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: "not-a-uuid",
    alumniId: randomUUID(),
    membership: { role: "admin" },
    alumni: failedRow(),
  });
  assert.equal(res.status, 400);
});

test("unauth requests 401", () => {
  const res = simulate({
    authUserId: null,
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    membership: null,
    alumni: failedRow(),
  });
  assert.equal(res.status, 401);
});

test("no response body ever contains the stored enrichment_error", () => {
  const stored = "Apify run failed: some internal detail";
  const scenarios: SimReq[] = [
    {
      authUserId: randomUUID(),
      organizationId: randomUUID(),
      alumniId: randomUUID(),
      membership: { role: "admin" },
      alumni: failedRow({ enrichment_error: stored }),
    },
    {
      authUserId: randomUUID(),
      organizationId: randomUUID(),
      alumniId: randomUUID(),
      membership: { role: "admin" },
      alumni: failedRow({ enrichment_error: stored, linkedin_url: null }),
    },
  ];
  for (const scenario of scenarios) {
    const res = simulate(scenario);
    assert.ok(!JSON.stringify(res.body).includes(stored));
  }
});
