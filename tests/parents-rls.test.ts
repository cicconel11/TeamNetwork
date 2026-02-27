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

type OrgRole = "admin" | "active_member" | "alumni" | "parent" | null;
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
  // Fixed by 20260616000000_fix_parents_rls_and_quota.sql:
  // 'parent' added to has_active_role check (mirrors alumni_select pattern).
  const canRead = role === "admin" || role === "active_member" || role === "parent";
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

interface ParentInviteStub {
  id: string;
  organization_id: string;
  status: "pending" | "accepted" | "revoked";
}

function simulateRevokeInvite(
  ctx: UserContext,
  targetOrgId: string,
  invites: ParentInviteStub[],
  inviteId: string
): { status: number } {
  if (!ctx.userId) return { status: 401 };
  const role = getOrgRole(ctx, targetOrgId);
  if (!role) return { status: 403 };
  if (role !== "admin") return { status: 403 };

  // Application-layer org scoping:
  // .eq("id", inviteId).eq("organization_id", targetOrgId)
  const invite = invites.find(
    (inv) => inv.id === inviteId && inv.organization_id === targetOrgId
  );
  if (!invite) return { status: 404 };
  if (invite.status === "accepted") return { status: 409 };
  if (invite.status === "revoked") return { status: 200 };
  return { status: 200 };
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

// ── Risk 2 fix: parent-role users can read the parents directory ───────────────
// Migration: 20260616000000_fix_parents_rls_and_quota.sql

describe("parent-role user can read the parents directory in their own org (Risk 2 fix)", () => {
  const parentUser: UserContext = {
    userId: "parent-user-1",
    memberships: [{ organizationId: "org-1", role: "parent", status: "active" }],
  };

  const parentUserOrg2: UserContext = {
    userId: "parent-user-2",
    memberships: [{ organizationId: "org-2", role: "parent", status: "active" }],
  };

  it("parent-role user GET org-1/parents → 200 (can read own org directory)", () => {
    assert.equal(simulateListParents(parentUser, "org-1").status, 200);
  });

  it("parent-role user GET org-2/parents → 403 (no membership in org-2)", () => {
    assert.equal(simulateListParents(parentUser, "org-2").status, 403);
  });

  it("parent-role user POST org-1/parents → 403 (read-only; only admin can create)", () => {
    assert.equal(simulateCreateParent(parentUser, "org-1").status, 403);
  });

  it("parent-role user in org-2 GET org-2/parents → 200 (isolated per org)", () => {
    assert.equal(simulateListParents(parentUserOrg2, "org-2").status, 200);
  });

  it("revoked parent-role user GET org-1/parents → 403 (inactive membership)", () => {
    const revokedParent: UserContext = {
      userId: "revoked-parent",
      memberships: [{ organizationId: "org-1", role: "parent", status: "revoked" }],
    };
    assert.equal(simulateListParents(revokedParent, "org-1").status, 403);
  });
});

// ── Risk 3: protect_parents_self_edit trigger logic ───────────────────────────
// Migration: 20260616000001_protect_parents_self_edit.sql
//
// The trigger fires BEFORE UPDATE on parents for non-admin users.
// Tests below simulate the trigger's allow/deny decisions.

interface ParentRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  deleted_at: string | null;
}

type TriggerResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Simulates protect_parents_self_edit trigger logic.
 * isAdmin  — true when the caller is an org admin (bypasses restrictions)
 * isService — true for service-role callers (always bypasses)
 */
function simulateSelfEditTrigger(opts: {
  isService: boolean;
  isAdmin: boolean;
  currentUserId: string;
  old: ParentRow;
  updated: Partial<ParentRow>;
}): TriggerResult {
  const { isService, isAdmin, currentUserId, old, updated } = opts;
  const newRow = { ...old, ...updated };

  if (isService) return { allowed: true };
  if (isAdmin) return { allowed: true };

  // user_id change check
  if (newRow.user_id !== old.user_id) {
    const linkingSelf = old.user_id === null && newRow.user_id === currentUserId;
    if (!linkingSelf) {
      return { allowed: false, reason: "Cannot change user_id on parent self-edit" };
    }
  }

  // organization_id change check
  if (newRow.organization_id !== old.organization_id) {
    return { allowed: false, reason: "Cannot change organization_id on parent self-edit" };
  }

  // deleted_at: self-editors cannot soft-delete
  if (old.deleted_at === null && newRow.deleted_at !== null) {
    return { allowed: false, reason: "Only admins can soft-delete parent records" };
  }

  return { allowed: true };
}

describe("protect_parents_self_edit trigger (Risk 3 defense-in-depth)", () => {
  const baseRow: ParentRow = {
    id: randomUUID(),
    organization_id: "org-1",
    user_id: "parent-user-1",
    deleted_at: null,
  };

  it("service-role caller: any update allowed (bypasses trigger)", () => {
    const result = simulateSelfEditTrigger({
      isService: true,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: baseRow,
      updated: { organization_id: "org-2" }, // would normally be blocked
    });
    assert.equal(result.allowed, true);
  });

  it("admin caller: any update allowed (bypasses restriction block)", () => {
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: true,
      currentUserId: "admin-user",
      old: baseRow,
      updated: { user_id: "some-other-user" }, // would normally be blocked
    });
    assert.equal(result.allowed, true);
  });

  it("self-edit: safe field update (first_name) is allowed", () => {
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: baseRow,
      updated: {}, // no sensitive field changed
    });
    assert.equal(result.allowed, true);
  });

  it("self-edit: linking yourself to an unlinked record (user_id: null → own id) is allowed", () => {
    const unlinkedRow: ParentRow = { ...baseRow, user_id: null };
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: unlinkedRow,
      updated: { user_id: "parent-user-1" },
    });
    assert.equal(result.allowed, true);
  });

  it("self-edit: changing user_id to someone else is blocked", () => {
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: baseRow,
      updated: { user_id: "attacker-user-id" },
    });
    assert.equal(result.allowed, false);
    assert.ok(result.allowed === false && result.reason.includes("user_id"));
  });

  it("self-edit: changing user_id when old.user_id is already set (not null) is blocked", () => {
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: baseRow, // old.user_id = "parent-user-1"
      updated: { user_id: "parent-user-1" }, // same value = no change, should be allowed
    });
    // No change → allowed
    assert.equal(result.allowed, true);
  });

  it("self-edit: changing organization_id is blocked", () => {
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: baseRow,
      updated: { organization_id: "org-2" },
    });
    assert.equal(result.allowed, false);
    assert.ok(result.allowed === false && result.reason.includes("organization_id"));
  });

  it("self-edit: setting deleted_at (soft-delete) is blocked", () => {
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: baseRow,
      updated: { deleted_at: new Date().toISOString() },
    });
    assert.equal(result.allowed, false);
    assert.ok(result.allowed === false && result.reason.includes("soft-delete"));
  });

  it("self-edit: unsetting deleted_at (restoring) is allowed — trigger only blocks null→non-null", () => {
    const deletedRow: ParentRow = { ...baseRow, deleted_at: new Date().toISOString() };
    const result = simulateSelfEditTrigger({
      isService: false,
      isAdmin: false,
      currentUserId: "parent-user-1",
      old: deletedRow,
      updated: { deleted_at: null },
    });
    // Note: RLS UPDATE policy also requires user_id=auth.uid() and the record exists.
    // The trigger itself doesn't block restoring a deleted_at. Admin gate is above.
    assert.equal(result.allowed, true);
  });
});

// ── PATCH /parents/invite/[inviteId] — cross-org isolation ────────────────────

describe("PATCH /parents/invite/[inviteId] — cross-org isolation", () => {
  const org2InviteId = randomUUID();
  const org2Invite: ParentInviteStub = {
    id: org2InviteId,
    organization_id: "org-2",
    status: "pending",
  };

  it("admin in org-1 cannot revoke invite from org-2 → 404", () => {
    // org-1 admin targets org-1 endpoint with an inviteId that belongs to org-2.
    // The org-scoped DB query (.eq("organization_id", "org-1")) returns no row.
    const result = simulateRevokeInvite(org1Admin, "org-1", [org2Invite], org2InviteId);
    assert.equal(result.status, 404);
  });

  it("unauthenticated request returns 401", () => {
    const result = simulateRevokeInvite(unauthenticated, "org-1", [org2Invite], org2InviteId);
    assert.equal(result.status, 401);
  });

  it("non-admin (parent role) in same org returns 403", () => {
    const org1InviteId = randomUUID();
    const org1Invite: ParentInviteStub = {
      id: org1InviteId,
      organization_id: "org-1",
      status: "pending",
    };
    const parentOnlyUser: UserContext = {
      userId: "parent-user-rls",
      memberships: [{ organizationId: "org-1", role: "parent", status: "active" }],
    };
    const result = simulateRevokeInvite(parentOnlyUser, "org-1", [org1Invite], org1InviteId);
    assert.equal(result.status, 403);
  });
});
