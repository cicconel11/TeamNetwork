import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { menteePreferencesSchema } from "../src/lib/schemas/mentorship.ts";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/mentorship/preferences/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ── Shape / wiring invariants (static) ──────────────────────────────────────

test("route exports GET and PUT", () => {
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /export async function PUT/);
});

test("route is dynamic + nodejs runtime", () => {
  assert.match(routeSource, /export const dynamic = "force-dynamic"/);
  assert.match(routeSource, /export const runtime = "nodejs"/);
});

test("route enforces server-side user_id on write (no client override)", () => {
  // PUT body passed to upsert must have user_id: user.id from session
  assert.match(routeSource, /user_id: user\.id/);
  // Upsert target is the native table with correct conflict key
  assert.match(routeSource, /mentee_preferences/);
  assert.match(routeSource, /onConflict: "organization_id,user_id"/);
});

test("route rate-limits both GET and PUT", () => {
  assert.match(routeSource, /mentorship preferences read/);
  assert.match(routeSource, /mentorship preferences write/);
});

test("route uses Zod schema for payload validation", () => {
  assert.match(routeSource, /menteePreferencesSchema\.safeParse/);
});

// ── Route logic simulator ───────────────────────────────────────────────────
// Same pattern as tests/routes/organizations/members.test.ts — reproduce the
// branching decision graph without spinning up Next or Supabase.

type Role = "admin" | "active_member" | "alumni" | "parent";
type Status = "active" | "revoked" | "pending";

interface SimReq {
  method: "GET" | "PUT";
  authUserId: string | null;
  organizationId: string;
  requestedUserId?: string; // GET ?user_id=
  caller: { role: Role; status: Status } | null;
  body?: unknown; // PUT payload
}

interface SimRes {
  status: number;
  body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function simulate(req: SimReq): SimRes {
  if (!UUID.test(req.organizationId)) {
    return { status: 400, body: { error: "Invalid organization id" } };
  }
  if (!req.authUserId) return { status: 401, body: { error: "Unauthorized" } };

  const caller = req.caller;
  if (!caller || caller.status !== "active") {
    return { status: 403, body: { error: "Forbidden" } };
  }

  if (req.method === "GET") {
    let target = req.authUserId;
    if (req.requestedUserId) {
      if (!UUID.test(req.requestedUserId)) {
        return { status: 400, body: { error: "Invalid user id" } };
      }
      if (req.requestedUserId !== req.authUserId) {
        if (caller.role !== "admin") {
          return { status: 403, body: { error: "Forbidden" } };
        }
        target = req.requestedUserId;
      }
    }
    return { status: 200, body: { preferences: null, resolvedTarget: target } };
  }

  // PUT
  if (!["admin", "active_member", "alumni", "parent"].includes(caller.role)) {
    return { status: 403, body: { error: "Forbidden" } };
  }
  const parsed = menteePreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid payload" } };
  }
  return {
    status: 200,
    body: { preferences: { organization_id: req.organizationId, user_id: req.authUserId, ...parsed.data } },
  };
}

// ── Behavior ────────────────────────────────────────────────────────────────

test("GET self returns 200 with self as resolved target", () => {
  const userId = randomUUID();
  const res = simulate({
    method: "GET",
    authUserId: userId,
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolvedTarget, userId);
});

test("GET as admin with ?user_id= can read an org peer", () => {
  const adminId = randomUUID();
  const peerId = randomUUID();
  const res = simulate({
    method: "GET",
    authUserId: adminId,
    requestedUserId: peerId,
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolvedTarget, peerId);
});

test("GET as admin without ?user_id= returns own row", () => {
  const adminId = randomUUID();
  const res = simulate({
    method: "GET",
    authUserId: adminId,
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolvedTarget, adminId);
});

test("GET ?user_id= by non-admin is forbidden", () => {
  const userId = randomUUID();
  const peerId = randomUUID();
  const res = simulate({
    method: "GET",
    authUserId: userId,
    requestedUserId: peerId,
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "active" },
  });
  assert.equal(res.status, 403);
});

test("PUT validates schema; rejects bad shape", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "active" },
    body: { preferred_topics: "not-an-array" },
  });
  assert.equal(res.status, 400);
});

test("PUT upserts; server-enforced user_id echoed back", () => {
  const userId = randomUUID();
  const orgId = randomUUID();
  const res = simulate({
    method: "PUT",
    authUserId: userId,
    organizationId: orgId,
    caller: { role: "active_member", status: "active" },
    body: {
      goals: "grow",
      preferred_topics: ["leadership"],
      preferred_sports: ["basketball"],
      required_attributes: ["same_sport"],
    },
  });
  assert.equal(res.status, 200);
  const prefs = res.body.preferences as { user_id: string; organization_id: string };
  assert.equal(prefs.user_id, userId);
  assert.equal(prefs.organization_id, orgId);
});

test("PUT repeat is idempotent (upsert contract)", () => {
  const userId = randomUUID();
  const orgId = randomUUID();
  const body = { goals: "grow", preferred_topics: ["leadership"] };
  const a = simulate({
    method: "PUT",
    authUserId: userId,
    organizationId: orgId,
    caller: { role: "active_member", status: "active" },
    body,
  });
  const b = simulate({
    method: "PUT",
    authUserId: userId,
    organizationId: orgId,
    caller: { role: "active_member", status: "active" },
    body,
  });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(a.body.preferences, b.body.preferences);
});

test("PUT by revoked caller is forbidden", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "revoked" },
    body: { preferred_topics: [] },
  });
  assert.equal(res.status, 403);
});

test("PUT by non-member (no caller) is forbidden", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: null,
    body: { preferred_topics: [] },
  });
  assert.equal(res.status, 403);
});

test("unauthenticated requests rejected with 401", () => {
  const res = simulate({
    method: "GET",
    authUserId: null,
    organizationId: randomUUID(),
    caller: null,
  });
  assert.equal(res.status, 401);
});
