import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { mentorProfileNativeSchema } from "../src/lib/schemas/mentorship.ts";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/mentorship/mentor-profile/route.ts",
    import.meta.url
  ),
  "utf8"
);

test("route exports GET and PUT", () => {
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /export async function PUT/);
});

test("route uses native zod schema + native upsert conflict key", () => {
  assert.match(routeSource, /mentorProfileNativeSchema\.safeParse/);
  assert.match(routeSource, /onConflict: "user_id,organization_id"/);
  assert.match(routeSource, /from\("mentor_profiles"\)/);
});

test("route rate-limits read + write", () => {
  assert.match(routeSource, /mentor profile read/);
  assert.match(routeSource, /mentor profile write/);
});

// ── Route logic simulator ───────────────────────────────────────────────────

type Role = "admin" | "active_member" | "alumni" | "parent";
type Status = "active" | "revoked" | "pending";

interface SimReq {
  method: "GET" | "PUT";
  authUserId: string | null;
  organizationId: string;
  requestedUserId?: string;
  caller: { role: Role; status: Status } | null;
  /** Present when simulating a PUT with ?user_id= targeting a peer. */
  target?: { role: Role; status: Status } | null;
  body?: unknown;
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
    if (req.requestedUserId && req.requestedUserId !== req.authUserId) {
      if (!UUID.test(req.requestedUserId)) {
        return { status: 400, body: { error: "Invalid user id" } };
      }
      if (caller.role !== "admin") {
        return { status: 403, body: { error: "Forbidden" } };
      }
      target = req.requestedUserId;
    }
    return { status: 200, body: { profile: null, resolvedTarget: target } };
  }

  if (!["admin", "alumni"].includes(caller.role)) {
    return { status: 403, body: { error: "Forbidden" } };
  }

  let targetUserId = req.authUserId;
  if (req.requestedUserId && req.requestedUserId !== req.authUserId) {
    if (!UUID.test(req.requestedUserId)) {
      return { status: 400, body: { error: "Invalid user id" } };
    }
    if (caller.role !== "admin") {
      return { status: 403, body: { error: "Forbidden" } };
    }
    const t = req.target;
    if (
      !t ||
      t.status !== "active" ||
      !["admin", "alumni"].includes(t.role)
    ) {
      return { status: 403, body: { error: "Target user not eligible to mentor" } };
    }
    targetUserId = req.requestedUserId;
  }

  const parsed = mentorProfileNativeSchema.safeParse(req.body);
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid payload" } };
  }
  return {
    status: 200,
    body: {
      profile: {
        organization_id: req.organizationId,
        user_id: targetUserId,
        ...parsed.data,
      },
    },
  };
}

test("GET self works for any active member", () => {
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

test("GET as admin with ?user_id= reads peer", () => {
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

test("GET ?user_id= by non-admin is forbidden", () => {
  const res = simulate({
    method: "GET",
    authUserId: randomUUID(),
    requestedUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 403);
});

test("PUT self as alumni upserts own profile", () => {
  const userId = randomUUID();
  const orgId = randomUUID();
  const res = simulate({
    method: "PUT",
    authUserId: userId,
    organizationId: orgId,
    caller: { role: "alumni", status: "active" },
    body: {
      bio: "I can help",
      sports: ["basketball"],
      max_mentees: 2,
      accepting_new: true,
    },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as { user_id: string; organization_id: string };
  assert.equal(p.user_id, userId);
  assert.equal(p.organization_id, orgId);
});

test("PUT as active_member forbidden (mentees cannot be mentors)", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "active" },
    body: { sports: [] },
  });
  assert.equal(res.status, 403);
});

test("PUT admin ?user_id= can edit an eligible peer", () => {
  const adminId = randomUUID();
  const peerId = randomUUID();
  const res = simulate({
    method: "PUT",
    authUserId: adminId,
    requestedUserId: peerId,
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
    target: { role: "alumni", status: "active" },
    body: { sports: ["football"], max_mentees: 5, accepting_new: true },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as { user_id: string };
  assert.equal(p.user_id, peerId);
});

test("PUT admin ?user_id= targeting non-alumni/non-admin member forbidden", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    requestedUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
    target: { role: "active_member", status: "active" },
    body: { sports: [] },
  });
  assert.equal(res.status, 403);
});

test("PUT invalid payload rejected via zod", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    body: { max_mentees: "not-a-number" },
  });
  assert.equal(res.status, 400);
});

test("unauth requests 401", () => {
  const res = simulate({
    method: "GET",
    authUserId: null,
    organizationId: randomUUID(),
    caller: null,
  });
  assert.equal(res.status, 401);
});

test("revoked caller forbidden", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "revoked" },
    body: { sports: [] },
  });
  assert.equal(res.status, 403);
});
