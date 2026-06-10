import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/mentorship/mentor-profile/generate-bio/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ── Source assertions ───────────────────────────────────────────────────────

test("route exports POST", () => {
  assert.match(routeSource, /export async function POST/);
});

test("route rate-limits regeneration at the right feature + limit", () => {
  assert.match(routeSource, /feature: "mentorship bio regeneration"/);
  assert.match(routeSource, /limitPerUser: 5/);
  assert.match(routeSource, /checkRateLimit/);
});

test("route regenerates with allowManualOverwrite true", () => {
  assert.match(routeSource, /regenerateMentorBio\(/);
  assert.match(routeSource, /allowManualOverwrite: true/);
});

test("route mirrors mentor-profile auth (membership + admin user_id targeting)", () => {
  assert.match(routeSource, /createAuthenticatedApiClient/);
  assert.match(routeSource, /user_organization_roles/);
  assert.match(routeSource, /searchParams\.get\("user_id"\)/);
});

test("route gates spend with dev-admin bypass + AiCapReachedError", () => {
  assert.match(routeSource, /isDevAdmin\(user\)/);
  assert.match(routeSource, /checkAiSpend/);
  assert.match(routeSource, /AiCapReachedError/);
});

test("route returns ai_generated bio_source", () => {
  assert.match(routeSource, /bio_source: result\.bioSource/);
});

test("route 404s when there is no mentor profile to regenerate", () => {
  assert.match(routeSource, /No mentor profile to regenerate/);
  assert.match(routeSource, /status: 404/);
});

// ── Route logic simulator ───────────────────────────────────────────────────

type Role = "admin" | "active_member" | "alumni" | "parent";
type Status = "active" | "revoked" | "pending";

interface SimReq {
  authUserId: string | null;
  organizationId: string;
  requestedUserId?: string;
  caller: { role: Role; status: Status } | null;
  target?: { role: Role; status: Status } | null;
  /** false simulates a user with no mentor_profiles row. */
  hasProfile?: boolean;
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
  if (
    !caller ||
    caller.status !== "active" ||
    !["admin", "alumni"].includes(caller.role)
  ) {
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
    if (!t || t.status !== "active" || !["admin", "alumni"].includes(t.role)) {
      return { status: 403, body: { error: "Target user not eligible to mentor" } };
    }
    targetUserId = req.requestedUserId;
  }

  if (req.hasProfile === false) {
    return { status: 404, body: { error: "No mentor profile to regenerate" } };
  }

  return {
    status: 200,
    body: { bio: "Generated.", model: "glm-5", bio_source: "ai_generated", resolvedTarget: targetUserId },
  };
}

test("self regenerate allowed for alumni", () => {
  const userId = randomUUID();
  const res = simulate({
    authUserId: userId,
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolvedTarget, userId);
  assert.equal(res.body.bio_source, "ai_generated");
});

test("self regenerate allowed for admin", () => {
  const userId = randomUUID();
  const res = simulate({
    authUserId: userId,
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
  });
  assert.equal(res.status, 200);
});

test("non-admin ?user_id=other is forbidden", () => {
  const res = simulate({
    authUserId: randomUUID(),
    requestedUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    target: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 403);
});

test("admin ?user_id= targeting eligible peer regenerates that peer", () => {
  const adminId = randomUUID();
  const peerId = randomUUID();
  const res = simulate({
    authUserId: adminId,
    requestedUserId: peerId,
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
    target: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolvedTarget, peerId);
});

test("admin ?user_id= targeting non-mentor member forbidden", () => {
  const res = simulate({
    authUserId: randomUUID(),
    requestedUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
    target: { role: "active_member", status: "active" },
  });
  assert.equal(res.status, 403);
});

test("active_member caller forbidden (mentees cannot regenerate)", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "active" },
  });
  assert.equal(res.status, 403);
});

test("missing mentor profile yields 404", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    hasProfile: false,
  });
  assert.equal(res.status, 404);
});

test("unauth requests 401", () => {
  const res = simulate({
    authUserId: null,
    organizationId: randomUUID(),
    caller: null,
  });
  assert.equal(res.status, 401);
});

test("revoked caller forbidden", () => {
  const res = simulate({
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "revoked" },
  });
  assert.equal(res.status, 403);
});
