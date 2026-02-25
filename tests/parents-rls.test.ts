/**
 * Parents cross-org isolation tests
 *
 * Verifies that org-scoping at the application layer prevents data leakage
 * across organizations. These tests simulate the access-control logic in
 * the route handlers and document the expected isolation guarantees.
 *
 * Note: RLS policies provide a second layer of enforcement at the DB layer
 * (service client bypasses RLS for internal operations, auth client uses it).
 * These tests focus on the application-layer scoping.
 *
 * Run: node --test --loader ./tests/ts-loader.js tests/parents-rls.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────────

type OrgRole = "admin" | "active_member" | "alumni" | null;
type MemberStatus = "active" | "pending" | "revoked";

interface Membership {
  organizationId: string;
  role: OrgRole;
  status: MemberStatus;
}

interface UserContext {
  userId: string | null;
  memberships: Membership[];
}

interface ParentStub {
  id: string;
  organization_id: string;
  deleted_at: string | null;
}

// ── Membership helpers ─────────────────────────────────────────────────────────

/**
 * Returns the user's effective role in the target org, or null if no active membership.
 * Mirrors: supabase.from("user_organization_roles").select("role")
 *          .eq("user_id", user.id).eq("organization_id", orgId).maybeSingle()
 */
function getOrgRole(ctx: UserContext, orgId: string): OrgRole | null {
  const m = ctx.memberships.find((m) => m.organizationId === orgId);
  if (!m || m.status !== "active") return null;
  return m.role;
}

// ── Route access simulations ───────────────────────────────────────────────────

function simulateListParents(ctx: UserContext, targetOrgId: string): { status: number } {
  if (!ctx.userId) return { status: 401 };
  const role = getOrgRole(ctx, targetOrgId);
  if (!role) return { status: 403 };
  const canRead = role === "admin" || role === "active_member";
  return { status: canRead ? 200 : 403 };
}

function simulateCreateParent(ctx: UserContext, targetOrgId: string): { status: number } {
  if (!ctx.userId) return { status: 401 };
  const role = getOrgRole(ctx, targetOrgId);
  if (!role) return { status: 403 };
  return { status: role === "admin" ? 201 : 403 };
}

function simulatePatchParent(
  ctx: UserContext,
  targetOrgId: string,
  parents: ParentStub[],
  parentId: string
): { status: number } {
  if (!ctx.userId) return { status: 401 };
  const role = getOrgRole(ctx, targetOrgId);
  if (!role) return { status: 403 };
  if (role !== "admin") return { status: 403 };

  // Application-layer org scoping:
  // .eq("id", parentId).eq("organization_id", organizationId).is("deleted_at", null)
  const exists = parents.some(
    (p) => p.id === parentId && p.organization_id === targetOrgId && p.deleted_at === null
  );
  return { status: exists ? 200 : 404 };
}

function simulateDeleteParent(
  ctx: UserContext,
  targetOrgId: string,
  parents: ParentStub[],
  parentId: string
): { status: number } {
  if (!ctx.userId) return { status: 401 };
  const role = getOrgRole(ctx, targetOrgId);
  if (!role) return { status: 403 };
  if (role !== "admin") return { status: 403 };

  const exists = parents.some(
    (p) => p.id === parentId && p.organization_id === targetOrgId && p.deleted_at === null
  );
  return { status: exists ? 200 : 404 };
}

function simulateSendInvite(ctx: UserContext, targetOrgId: string): { status: number } {
  if (!ctx.userId) return { status: 401 };
  const role = getOrgRole(ctx, targetOrgId);
  if (!role) return { status: 403 };
  return { status: role === "admin" ? 200 : 403 };
}

// ── Test fixtures ──────────────────────────────────────────────────────────────

const org1Admin: UserContext = {
  userId: "admin-org1",
  memberships: [{ organizationId: "org-1", role: "admin", status: "active" }],
};

const org1Member: UserContext = {
  userId: "member-org1",
  memberships: [{ organizationId: "org-1", role: "active_member", status: "active" }],
};

const dualAdmin: UserContext = {
  userId: "admin-both",
  memberships: [
    { organizationId: "org-1", role: "admin", status: "active" },
    { organizationId: "org-2", role: "admin", status: "active" },
  ],
};

const unauthenticated: UserContext = { userId: null, memberships: [] };

// ── org-1-only admin cannot access org-2 ──────────────────────────────────────

describe("org-1 admin has no membership in org-2 → all org-2 endpoints return 403", () => {
  const org2Parent: ParentStub = {
    id: randomUUID(),
    organization_id: "org-2",
    deleted_at: null,
  };

  it("GET org-2/parents → 403", () => {
    assert.equal(simulateListParents(org1Admin, "org-2").status, 403);
  });

  it("POST org-2/parents → 403", () => {
    assert.equal(simulateCreateParent(org1Admin, "org-2").status, 403);
  });

  it("PATCH org-2/parents/:id → 403", () => {
    assert.equal(
      simulatePatchParent(org1Admin, "org-2", [org2Parent], org2Parent.id).status,
      403
    );
  });

  it("DELETE org-2/parents/:id → 403", () => {
    assert.equal(
      simulateDeleteParent(org1Admin, "org-2", [org2Parent], org2Parent.id).status,
      403
    );
  });

  it("POST org-2/parents/invite → 403", () => {
    assert.equal(simulateSendInvite(org1Admin, "org-2").status, 403);
  });
});

// ── Dual-org admin cannot leak parentId across orgs ───────────────────────────

describe("Admin in both orgs: application-layer org scoping prevents cross-org parentId use", () => {
  const org2Parent: ParentStub = {
    id: randomUUID(),
    organization_id: "org-2",
    deleted_at: null,
  };

  it("PATCH org-1/parents with org-2 parentId → 404 (app-layer scoping)", () => {
    // Dual admin targets org-1 route, but passes a parentId that belongs to org-2.
    // Route filters by organization_id = org-1, so org-2's parent is not found.
    const result = simulatePatchParent(dualAdmin, "org-1", [org2Parent], org2Parent.id);
    assert.equal(result.status, 404);
  });

  it("DELETE org-1/parents with org-2 parentId → 404 (app-layer scoping)", () => {
    const result = simulateDeleteParent(dualAdmin, "org-1", [org2Parent], org2Parent.id);
    assert.equal(result.status, 404);
  });

  it("Dual admin CAN access their own org-1 parent", () => {
    const org1Parent: ParentStub = {
      id: randomUUID(),
      organization_id: "org-1",
      deleted_at: null,
    };
    const result = simulatePatchParent(dualAdmin, "org-1", [org1Parent], org1Parent.id);
    assert.equal(result.status, 200);
  });

  it("Dual admin CAN access their own org-2 parent", () => {
    const result = simulatePatchParent(dualAdmin, "org-2", [org2Parent], org2Parent.id);
    assert.equal(result.status, 200);
  });
});

// ── active_member in org-1 blocked from org-2 ─────────────────────────────────

describe("active_member in org-1 has no membership in org-2", () => {
  it("GET org-2/parents → 403", () => {
    assert.equal(simulateListParents(org1Member, "org-2").status, 403);
  });

  it("GET org-1/parents → 200 (member can read their own org)", () => {
    assert.equal(simulateListParents(org1Member, "org-1").status, 200);
  });
});

// ── Unauthenticated user has no access anywhere ────────────────────────────────

describe("Unauthenticated user gets 401 for all endpoints", () => {
  const aParent: ParentStub = { id: randomUUID(), organization_id: "org-1", deleted_at: null };

  it("GET /parents → 401", () => {
    assert.equal(simulateListParents(unauthenticated, "org-1").status, 401);
  });

  it("POST /parents → 401", () => {
    assert.equal(simulateCreateParent(unauthenticated, "org-1").status, 401);
  });

  it("PATCH /parents/:id → 401", () => {
    assert.equal(
      simulatePatchParent(unauthenticated, "org-1", [aParent], aParent.id).status,
      401
    );
  });

  it("DELETE /parents/:id → 401", () => {
    assert.equal(
      simulateDeleteParent(unauthenticated, "org-1", [aParent], aParent.id).status,
      401
    );
  });

  it("POST /parents/invite → 401", () => {
    assert.equal(simulateSendInvite(unauthenticated, "org-1").status, 401);
  });
});

// ── Revoked and pending memberships are not treated as active ──────────────────

describe("Revoked and pending memberships provide no access", () => {
  const revokedAdmin: UserContext = {
    userId: "revoked-admin",
    memberships: [{ organizationId: "org-1", role: "admin", status: "revoked" }],
  };

  const pendingAdmin: UserContext = {
    userId: "pending-admin",
    memberships: [{ organizationId: "org-1", role: "admin", status: "pending" }],
  };

  it("revoked admin GET /parents → 403", () => {
    assert.equal(simulateListParents(revokedAdmin, "org-1").status, 403);
  });

  it("revoked admin POST /parents → 403", () => {
    assert.equal(simulateCreateParent(revokedAdmin, "org-1").status, 403);
  });

  it("pending admin GET /parents → 403 (membership not yet active)", () => {
    assert.equal(simulateListParents(pendingAdmin, "org-1").status, 403);
  });
});
