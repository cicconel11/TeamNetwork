import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/alumni/[alumniId]/link-user/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ── Source assertions ───────────────────────────────────────────────────────

test("route exports POST", () => {
  assert.match(routeSource, /export async function POST/);
});

test("route validates the body with zod (uuid user_id) via validateJson", () => {
  assert.match(routeSource, /z\.object\(\{/);
  assert.match(routeSource, /user_id: baseSchemas\.uuid/);
  assert.match(routeSource, /validateJson\(req, linkUserSchema/);
});

test("route is admin-only", () => {
  assert.match(routeSource, /membership\?\.role !== "admin"/);
  assert.match(routeSource, /Forbidden/);
});

test("route performs the link via the service client", () => {
  assert.match(routeSource, /createServiceClient/);
  assert.match(routeSource, /\.update\(\{\s*user_id: body\.user_id/);
});

test("route writes an audit row for the admin action", () => {
  assert.match(routeSource, /data_access_log/);
  assert.match(routeSource, /resource_type: "alumni_user_link"/);
  assert.match(routeSource, /actor_user_id: user\.id/);
});

test("route covers the documented conflict / membership errors", () => {
  assert.match(routeSource, /Profile already linked/);
  assert.match(routeSource, /Target user is not an active member of this organization/);
  assert.match(routeSource, /User already has a linked alumni profile/);
});

test("route excludes soft-deleted rows everywhere it touches alumni", () => {
  const deletedAtFilters = routeSource.match(/\.is\("deleted_at", null\)/g) ?? [];
  // load target alumni, scan for an existing link, and guard the update
  assert.ok(deletedAtFilters.length >= 3);
});

// ── Route logic simulator ───────────────────────────────────────────────────

type Role = "admin" | "active_member" | "alumni" | "parent";
type Status = "active" | "revoked" | "pending";

interface SimAlumniRow {
  id: string;
  user_id: string | null;
  deleted_at: string | null;
}

interface SimReq {
  authUserId: string | null;
  organizationId: string;
  alumniId: string;
  body: unknown;
  caller: { role: Role; status: Status } | null;
  alumni: SimAlumniRow | null;
  targetMembership: { role: Role; status: Status } | null;
  /** Other live alumni rows in this org already linked to the target user. */
  otherLinkedAlumni?: SimAlumniRow[];
}

interface SimRes {
  status: number;
  body: Record<string, unknown>;
  row?: SimAlumniRow;
  audit?: { actorUserId: string; resourceType: string; resourceId: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function simulate(req: SimReq): SimRes {
  if (!UUID.test(req.organizationId) || !UUID.test(req.alumniId)) {
    return { status: 400, body: { error: "Invalid identifier" } };
  }
  if (!req.authUserId) return { status: 401, body: { error: "Unauthorized" } };

  const body = req.body as { user_id?: unknown } | null;
  const targetUserId = typeof body?.user_id === "string" ? body.user_id : "";
  if (!UUID.test(targetUserId)) {
    return { status: 400, body: { error: "Invalid request body" } };
  }

  const caller = req.caller;
  if (!caller || caller.status !== "active" || caller.role !== "admin") {
    return { status: 403, body: { error: "Forbidden" } };
  }

  const alumni = req.alumni && req.alumni.deleted_at === null ? req.alumni : null;
  if (!alumni) return { status: 404, body: { error: "Alumni not found" } };

  if (alumni.user_id) {
    return { status: 409, body: { error: "Profile already linked" } };
  }

  const target = req.targetMembership;
  if (!target || target.status !== "active") {
    return {
      status: 403,
      body: { error: "Target user is not an active member of this organization" },
    };
  }

  const existing = (req.otherLinkedAlumni ?? []).find(
    (row) => row.deleted_at === null && row.user_id === targetUserId
  );
  if (existing) {
    return { status: 409, body: { error: "User already has a linked alumni profile" } };
  }

  return {
    status: 200,
    body: { ok: true },
    row: { ...alumni, user_id: targetUserId },
    audit: {
      actorUserId: req.authUserId,
      resourceType: "alumni_user_link",
      resourceId: `${req.alumniId}:${targetUserId}`,
    },
  };
}

function unlinkedAlumni(overrides: Partial<SimAlumniRow> = {}): SimAlumniRow {
  return { id: randomUUID(), user_id: null, deleted_at: null, ...overrides };
}

test("admin links an unlinked alumni to an active member and audits it", () => {
  const adminId = randomUUID();
  const targetId = randomUUID();
  const alumniId = randomUUID();
  const res = simulate({
    authUserId: adminId,
    organizationId: randomUUID(),
    alumniId,
    body: { user_id: targetId },
    caller: { role: "admin", status: "active" },
    alumni: unlinkedAlumni({ id: alumniId }),
    targetMembership: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.row?.user_id, targetId);
  assert.deepEqual(res.audit, {
    actorUserId: adminId,
    resourceType: "alumni_user_link",
    resourceId: `${alumniId}:${targetId}`,
  });
});

test("non-admin caller is forbidden", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: randomUUID() },
    caller: { role: "active_member", status: "active" },
    alumni: unlinkedAlumni(),
    targetMembership: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "Forbidden");
});

test("revoked admin is forbidden", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: randomUUID() },
    caller: { role: "admin", status: "revoked" },
    alumni: unlinkedAlumni(),
    targetMembership: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 403);
});

test("already-linked alumni yields 409 Profile already linked", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: randomUUID() },
    caller: { role: "admin", status: "active" },
    alumni: unlinkedAlumni({ user_id: randomUUID() }),
    targetMembership: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "Profile already linked");
});

test("target without an active membership yields 403", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: randomUUID() },
    caller: { role: "admin", status: "active" },
    alumni: unlinkedAlumni(),
    targetMembership: { role: "alumni", status: "pending" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "Target user is not an active member of this organization");
});

test("target already linked to another live alumni row yields 409", () => {
  const targetId = randomUUID();
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: targetId },
    caller: { role: "admin", status: "active" },
    alumni: unlinkedAlumni(),
    targetMembership: { role: "alumni", status: "active" },
    otherLinkedAlumni: [unlinkedAlumni({ user_id: targetId })],
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "User already has a linked alumni profile");
});

test("a soft-deleted prior link does not block re-linking", () => {
  const targetId = randomUUID();
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: targetId },
    caller: { role: "admin", status: "active" },
    alumni: unlinkedAlumni(),
    targetMembership: { role: "alumni", status: "active" },
    otherLinkedAlumni: [
      unlinkedAlumni({ user_id: targetId, deleted_at: new Date().toISOString() }),
    ],
  });
  assert.equal(res.status, 200);
});

test("soft-deleted alumni yields 404", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: randomUUID() },
    caller: { role: "admin", status: "active" },
    alumni: unlinkedAlumni({ deleted_at: new Date().toISOString() }),
    targetMembership: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 404);
});

test("invalid body (non-uuid user_id) yields 400", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: "not-a-uuid" },
    caller: { role: "admin", status: "active" },
    alumni: unlinkedAlumni(),
    targetMembership: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 400);
});

test("unauth requests 401", () => {
  const res = simulate({
    authUserId: null,
    organizationId: randomUUID(),
    alumniId: randomUUID(),
    body: { user_id: randomUUID() },
    caller: null,
    alumni: unlinkedAlumni(),
    targetMembership: null,
  });
  assert.equal(res.status, 401);
});
