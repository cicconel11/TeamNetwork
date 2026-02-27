/**
 * Parents Access Control — exhaustive role permission matrix
 *
 * Key divergence from alumni directory:
 * - alumni role CANNOT read parents list (alumni directory allows alumni to read alumni)
 * - parent role CAN read parents list (added to SELECT policy in migration 20260616)
 * - Legacy "member" role CAN read parents list (raw DB value before normalization)
 *
 * Run: node --test --loader ./tests/ts-loader.js tests/parents-access.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

type OrgRole = "admin" | "active_member" | "member" | "alumni" | "parent" | null;
type MemberStatus = "active" | "pending" | "revoked" | null;

interface AccessRequest {
  userId: string | null;
  role: OrgRole;
  status: MemberStatus;
}

// ── Simulation functions (mirror route handler access checks) ─────────────────

/**
 * Mirrors GET /parents access check:
 * rawRole === "admin" || rawRole === "active_member" || rawRole === "member"
 */
function canReadParents(req: AccessRequest): { status: number } {
  if (!req.userId) return { status: 401 };
  if (req.status !== "active") return { status: 403 };
  const allowed =
    req.role === "admin" ||
    req.role === "active_member" ||
    req.role === "member" ||
    req.role === "parent";
  return { status: allowed ? 200 : 403 };
}

/**
 * Mirrors POST /parents access check: admin only
 */
function canCreateParent(req: AccessRequest): { status: number } {
  if (!req.userId) return { status: 401 };
  if (req.status !== "active") return { status: 403 };
  return { status: req.role === "admin" ? 201 : 403 };
}

/**
 * Mirrors PATCH /parents/:id access check: admin only
 */
function canUpdateParent(req: AccessRequest): { status: number } {
  if (!req.userId) return { status: 401 };
  if (req.status !== "active") return { status: 403 };
  return { status: req.role === "admin" ? 200 : 403 };
}

/**
 * Mirrors DELETE /parents/:id access check: admin only
 */
function canDeleteParent(req: AccessRequest): { status: number } {
  if (!req.userId) return { status: 401 };
  if (req.status !== "active") return { status: 403 };
  return { status: req.role === "admin" ? 200 : 403 };
}

/**
 * Mirrors POST /parents/invite access check: admin only
 */
function canSendInvite(req: AccessRequest): { status: number } {
  if (!req.userId) return { status: 401 };
  if (req.status !== "active") return { status: 403 };
  return { status: req.role === "admin" ? 200 : 403 };
}

// ── GET /parents — access matrix ─────────────────────────────────────────────

describe("GET /parents — access control matrix", () => {
  it("returns 401 for unauthenticated request", () => {
    assert.equal(
      canReadParents({ userId: null, role: null, status: null }).status,
      401
    );
  });

  it("returns 200 for admin", () => {
    assert.equal(
      canReadParents({ userId: "u1", role: "admin", status: "active" }).status,
      200
    );
  });

  it("returns 200 for active_member", () => {
    assert.equal(
      canReadParents({ userId: "u1", role: "active_member", status: "active" }).status,
      200
    );
  });

  it("returns 200 for legacy member role (raw DB value before normalization)", () => {
    // Route reads raw DB value; "member" is a valid legacy value that should be allowed
    assert.equal(
      canReadParents({ userId: "u1", role: "member", status: "active" }).status,
      200
    );
  });

  it("returns 403 for alumni — parents list is NOT available to alumni (unlike alumni directory)", () => {
    assert.equal(
      canReadParents({ userId: "u1", role: "alumni", status: "active" }).status,
      403
    );
  });

  it("returns 200 for parent role — parents can read their own org's directory", () => {
    // parent role was added to the SELECT policy in migration 20260616
    assert.equal(
      canReadParents({ userId: "u1", role: "parent", status: "active" }).status,
      200
    );
  });

  it("returns 403 for revoked member", () => {
    // Revoked user's membership row has status="revoked"; treated as 403
    assert.equal(
      canReadParents({ userId: "u1", role: "active_member", status: "revoked" }).status,
      403
    );
  });

  it("returns 403 for pending member (membership not yet active)", () => {
    assert.equal(
      canReadParents({ userId: "u1", role: "active_member", status: "pending" }).status,
      403
    );
  });

  it("returns 403 for authenticated user with no org membership (role=null)", () => {
    assert.equal(
      canReadParents({ userId: "u1", role: null, status: null }).status,
      403
    );
  });
});

// ── POST /parents — write access (admin only) ─────────────────────────────────

describe("POST /parents — write access control (admin only)", () => {
  it("returns 201 for admin", () => {
    assert.equal(
      canCreateParent({ userId: "u1", role: "admin", status: "active" }).status,
      201
    );
  });

  it("returns 403 for active_member", () => {
    assert.equal(
      canCreateParent({ userId: "u1", role: "active_member", status: "active" }).status,
      403
    );
  });

  it("returns 403 for legacy member role", () => {
    assert.equal(
      canCreateParent({ userId: "u1", role: "member", status: "active" }).status,
      403
    );
  });

  it("returns 403 for alumni", () => {
    assert.equal(
      canCreateParent({ userId: "u1", role: "alumni", status: "active" }).status,
      403
    );
  });

  it("returns 403 for parent role", () => {
    assert.equal(
      canCreateParent({ userId: "u1", role: "parent", status: "active" }).status,
      403
    );
  });

  it("returns 403 for revoked member", () => {
    assert.equal(
      canCreateParent({ userId: "u1", role: "admin", status: "revoked" }).status,
      403
    );
  });

  it("returns 401 for unauthenticated", () => {
    assert.equal(
      canCreateParent({ userId: null, role: null, status: null }).status,
      401
    );
  });
});

// ── PATCH /parents/:id — write access (admin only) ───────────────────────────

describe("PATCH /parents/:id — write access control (admin only)", () => {
  it("returns 200 for admin", () => {
    assert.equal(
      canUpdateParent({ userId: "u1", role: "admin", status: "active" }).status,
      200
    );
  });

  it("returns 403 for active_member", () => {
    assert.equal(
      canUpdateParent({ userId: "u1", role: "active_member", status: "active" }).status,
      403
    );
  });

  it("returns 403 for alumni", () => {
    assert.equal(
      canUpdateParent({ userId: "u1", role: "alumni", status: "active" }).status,
      403
    );
  });

  it("returns 403 for parent role", () => {
    assert.equal(
      canUpdateParent({ userId: "u1", role: "parent", status: "active" }).status,
      403
    );
  });

  it("returns 401 for unauthenticated", () => {
    assert.equal(
      canUpdateParent({ userId: null, role: null, status: null }).status,
      401
    );
  });
});

// ── DELETE /parents/:id — write access (admin only) ──────────────────────────

describe("DELETE /parents/:id — write access control (admin only)", () => {
  it("returns 200 for admin", () => {
    assert.equal(
      canDeleteParent({ userId: "u1", role: "admin", status: "active" }).status,
      200
    );
  });

  it("returns 403 for active_member", () => {
    assert.equal(
      canDeleteParent({ userId: "u1", role: "active_member", status: "active" }).status,
      403
    );
  });

  it("returns 403 for alumni", () => {
    assert.equal(
      canDeleteParent({ userId: "u1", role: "alumni", status: "active" }).status,
      403
    );
  });

  it("returns 403 for parent role", () => {
    assert.equal(
      canDeleteParent({ userId: "u1", role: "parent", status: "active" }).status,
      403
    );
  });

  it("returns 401 for unauthenticated", () => {
    assert.equal(
      canDeleteParent({ userId: null, role: null, status: null }).status,
      401
    );
  });
});

// ── POST /parents/invite — invite creation (admin only) ───────────────────────

describe("POST /parents/invite — access control (admin only)", () => {
  it("returns 200 for admin", () => {
    assert.equal(
      canSendInvite({ userId: "u1", role: "admin", status: "active" }).status,
      200
    );
  });

  it("returns 403 for active_member", () => {
    assert.equal(
      canSendInvite({ userId: "u1", role: "active_member", status: "active" }).status,
      403
    );
  });

  it("returns 403 for alumni", () => {
    assert.equal(
      canSendInvite({ userId: "u1", role: "alumni", status: "active" }).status,
      403
    );
  });

  it("returns 403 for parent role", () => {
    assert.equal(
      canSendInvite({ userId: "u1", role: "parent", status: "active" }).status,
      403
    );
  });

  it("returns 403 for legacy member role", () => {
    assert.equal(
      canSendInvite({ userId: "u1", role: "member", status: "active" }).status,
      403
    );
  });

  it("returns 401 for unauthenticated", () => {
    assert.equal(
      canSendInvite({ userId: null, role: null, status: null }).status,
      401
    );
  });
});
