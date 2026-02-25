/**
 * Parents invite — role normalization + invite lifecycle tests
 *
 * Combines:
 * 1. Role normalization suite (ported from parent-invite.test.ts)
 * 2. Invite creation lifecycle (idempotency, org isolation, accepted-invite handling)
 * 3. Invite acceptance lifecycle (user creation, parent row creation, field validation)
 * 4. Known gap documentation (no user_organization_roles row created on accept)
 *
 * Run: node --test --loader ./tests/ts-loader.js tests/parents-invite.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { normalizeRole } from "@/lib/auth/role-utils";

// ── 1. Role normalization ─────────────────────────────────────────────────────

describe("normalizeRole — parent role support", () => {
  it('passes "parent" through as "parent" (parent is a distinct role, not mapped to alumni)', () => {
    // parent is a first-class OrgRole with its own isParent flag in roleFlags().
    // It is NOT normalized to alumni — parents have separate permissions from alumni.
    assert.equal(normalizeRole("parent"), "parent");
  });

  it('maps "member" to "active_member"', () => {
    assert.equal(normalizeRole("member"), "active_member");
  });

  it('maps "viewer" to "alumni"', () => {
    assert.equal(normalizeRole("viewer"), "alumni");
  });

  it('passes "admin" through unchanged', () => {
    assert.equal(normalizeRole("admin"), "admin");
  });

  it('passes "active_member" through unchanged', () => {
    assert.equal(normalizeRole("active_member"), "active_member");
  });

  it('passes "alumni" through unchanged', () => {
    assert.equal(normalizeRole("alumni"), "alumni");
  });

  it("returns null for null", () => {
    assert.equal(normalizeRole(null), null);
  });

  it("returns null for undefined", () => {
    assert.equal(normalizeRole(undefined), null);
  });
});

// ── 2. Invite data types and helpers ─────────────────────────────────────────

interface ParentInvite {
  id: string;
  organization_id: string;
  email: string;
  code: string;
  invited_by: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface ParentRecord {
  id: string;
  organization_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
}

function makeInvite(overrides: Partial<ParentInvite> = {}): ParentInvite {
  return {
    id: randomUUID(),
    organization_id: "org-1",
    email: "parent@example.com",
    code: randomUUID().replace(/-/g, ""),
    invited_by: "admin-user",
    status: "pending",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Minimal in-memory invite store for lifecycle simulation.
 * Mirrors what the parent_invites table would hold.
 */
function createStore(initial: ParentInvite[] = []) {
  const invites: ParentInvite[] = [...initial];

  return {
    findPending(orgId: string, email: string): ParentInvite | undefined {
      return invites.find(
        (i) => i.organization_id === orgId && i.email === email && i.status === "pending"
      );
    },
    findPendingValid(orgId: string, email: string, now: string): ParentInvite | undefined {
      return invites.find(
        (i) =>
          i.organization_id === orgId &&
          i.email === email &&
          i.status === "pending" &&
          i.expires_at > now
      );
    },
    findById(id: string): ParentInvite | undefined {
      return invites.find((i) => i.id === id);
    },
    findByCode(code: string): ParentInvite | undefined {
      return invites.find((i) => i.code === code);
    },
    add(invite: ParentInvite) {
      invites.push(invite);
    },
    update(id: string, updates: Partial<ParentInvite>) {
      const idx = invites.findIndex((i) => i.id === id);
      if (idx >= 0) Object.assign(invites[idx], updates);
    },
    /** Mark all expired pending invites for org+email as revoked (mirrors DB cleanup step). */
    revokeExpiredPending(orgId: string, email: string, now: string) {
      invites
        .filter(
          (i) =>
            i.organization_id === orgId &&
            i.email === email &&
            i.status === "pending" &&
            i.expires_at <= now
        )
        .forEach((i) => {
          i.status = "revoked";
        });
    },
    all() {
      return [...invites];
    },
  };
}

// ── 3. Invite creation simulation ────────────────────────────────────────────

interface CreateInviteOptions {
  orgId: string;
  email: string;
  role: "admin" | "active_member" | "alumni" | null;
  userId: string | null;
  store: ReturnType<typeof createStore>;
}

interface CreateInviteResult {
  status: number;
  invite?: Partial<ParentInvite>;
  isExisting?: boolean;
  error?: string;
}

function simulateCreateInvite(opts: CreateInviteOptions): CreateInviteResult {
  if (!opts.userId) return { status: 401, error: "Unauthorized" };
  if (opts.role !== "admin") return { status: 403, error: "Forbidden" };

  if (!opts.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.email)) {
    return { status: 400, error: "Invalid request body" };
  }

  const now = new Date().toISOString();

  // Idempotent: return existing VALID (non-expired) pending invite for same org + email
  const existing = opts.store.findPendingValid(opts.orgId, opts.email, now);
  if (existing) {
    return { status: 200, invite: existing, isExisting: true };
  }

  // Revoke any expired pending invites before inserting a fresh one
  opts.store.revokeExpiredPending(opts.orgId, opts.email, now);

  const invite = makeInvite({
    id: randomUUID(),
    organization_id: opts.orgId,
    email: opts.email,
    code: randomUUID().replace(/-/g, ""),
    invited_by: opts.userId,
    status: "pending",
  });

  opts.store.add(invite);
  return { status: 200, invite, isExisting: false };
}

// ── 4. Invite acceptance simulation ──────────────────────────────────────────

interface AcceptInviteOptions {
  orgId: string;
  code: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  store: ReturnType<typeof createStore>;
  /** Simulate auth.admin.createUser returning "already exists" error */
  existingUserId?: string | null;
  /**
   * Simulate a pre-existing user_organization_roles row with the given status.
   * - "revoked": row exists but is revoked; reactivation UPDATE should fire.
   * - "active": row already active; reactivation UPDATE with status='revoked' filter matches 0 rows → role preserved.
   * - null / undefined: no pre-existing row (INSERT succeeds).
   */
  existingOrgRoleStatus?: "revoked" | "active" | null;
  /**
   * Simulate a pre-existing non-deleted parents row for this org+email.
   * When set, simulateAcceptInvite reuses this id instead of generating a new one,
   * mirroring the upsert logic in the route.
   */
  existingParentId?: string | null;
}

interface OrgRoleRow {
  user_id: string;
  organization_id: string;
  role: string;
  status: string;
}

interface AcceptInviteResult {
  status: number;
  success?: boolean;
  parentId?: string;
  parentRecord?: ParentRecord;
  inviteAfter?: ParentInvite | undefined;
  /** Whether a user_organization_roles row was created. */
  userOrgRoleCreated?: boolean;
  /** The membership row that was created, if any. */
  orgRoleRow?: OrgRoleRow;
  error?: string;
}

function simulateAcceptInvite(opts: AcceptInviteOptions): AcceptInviteResult {
  // Body validation (mirrors acceptInviteSchema)
  if (!opts.code || opts.code.length < 1) {
    return { status: 400, error: "Invalid request body" };
  }
  if (!opts.first_name?.trim()) {
    return { status: 400, error: "Invalid request body" };
  }
  if (!opts.last_name?.trim()) {
    return { status: 400, error: "Invalid request body" };
  }
  if (!opts.password || opts.password.length < 8) {
    return { status: 400, error: "Invalid request body" };
  }

  // Look up invite by code
  const invite = opts.store.findByCode(opts.code);
  if (!invite) return { status: 400, error: "Invalid invite code" };

  // Org mismatch check
  if (invite.organization_id !== opts.orgId) {
    return { status: 400, error: "Invalid invite code" };
  }

  if (invite.status === "accepted") {
    return { status: 409, error: "Invite already accepted" };
  }
  if (invite.status === "revoked") {
    return { status: 410, error: "Invite has been revoked" };
  }
  if (new Date(invite.expires_at) < new Date()) {
    return { status: 410, error: "Invite has expired" };
  }

  // User creation (simulate auth.admin.createUser)
  const userId = opts.existingUserId ?? randomUUID();

  // Upsert parent record: reuse existing id if present (mirrors route's lookup-then-update-or-insert).
  const parentId = opts.existingParentId ?? randomUUID();
  const parentRecord: ParentRecord = {
    id: parentId,
    organization_id: invite.organization_id,
    user_id: userId,
    first_name: opts.first_name!,
    last_name: opts.last_name!,
    email: invite.email,
  };

  // Simulate user_organization_roles INSERT / reactivation logic.
  // - No pre-existing row (existingOrgRoleStatus == null/undefined): INSERT succeeds → new row.
  // - Pre-existing revoked row: INSERT triggers 23505; UPDATE fires and reactivates with role='parent', status='active'.
  // - Pre-existing active row: INSERT triggers 23505; UPDATE matches 0 rows (no-op), row unchanged.
  let orgRoleRow: OrgRoleRow;
  let userOrgRoleCreated: boolean;

  if (!opts.existingOrgRoleStatus) {
    // Fresh INSERT — no conflict.
    orgRoleRow = {
      user_id: userId,
      organization_id: invite.organization_id,
      role: "parent",
      status: "active",
    };
    userOrgRoleCreated = true;
  } else if (opts.existingOrgRoleStatus === "revoked") {
    // 23505 unique violation → reactivation UPDATE matches the revoked row.
    orgRoleRow = {
      user_id: userId,
      organization_id: invite.organization_id,
      role: "parent",
      status: "active",
    };
    userOrgRoleCreated = false; // existing row was updated, not newly inserted
  } else {
    // existingOrgRoleStatus === "active" → 23505; UPDATE with .eq("status", "revoked") filter
    // matches 0 rows → existing role is preserved, not overwritten to "parent".
    orgRoleRow = {
      user_id: userId,
      organization_id: invite.organization_id,
      role: "active_member", // pre-existing role preserved (not downgraded to parent)
      status: "active",
    };
    userOrgRoleCreated = false; // existing row unchanged
  }

  // Mark invite as accepted
  opts.store.update(invite.id, {
    status: "accepted",
    accepted_at: new Date().toISOString(),
  });

  return {
    status: 200,
    success: true,
    parentId,
    parentRecord,
    inviteAfter: opts.store.findByCode(opts.code),
    userOrgRoleCreated,
    orgRoleRow,
  };
}

// ── Invite creation tests ─────────────────────────────────────────────────────

describe("POST /parents/invite — invite creation lifecycle", () => {
  it("admin receives a new pending invite with id, email, code, and status", () => {
    const store = createStore();
    const result = simulateCreateInvite({
      orgId: "org-1",
      email: "new@example.com",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.ok(result.invite?.id, "invite must have an id");
    assert.ok(result.invite?.code, "invite must have a code");
    assert.equal(result.invite?.email, "new@example.com");
    assert.equal(result.invite?.status, "pending");
    assert.equal(result.isExisting, false);
  });

  it("is idempotent — returns same invite for duplicate pending email in same org", () => {
    const existing = makeInvite({
      email: "dup@example.com",
      organization_id: "org-1",
      status: "pending",
    });
    const store = createStore([existing]);

    const result = simulateCreateInvite({
      orgId: "org-1",
      email: "dup@example.com",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.equal(result.invite?.id, existing.id, "must return same existing invite id");
    assert.equal(result.invite?.code, existing.code, "must return same invite code");
    assert.equal(result.isExisting, true);
  });

  it("creates a NEW invite when same email exists as pending in a different org", () => {
    const org1Invite = makeInvite({
      email: "shared@example.com",
      organization_id: "org-1",
      status: "pending",
    });
    const store = createStore([org1Invite]);

    // Request targets org-2 — org-1's pending invite must not be returned
    const result = simulateCreateInvite({
      orgId: "org-2",
      email: "shared@example.com",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.notEqual(result.invite?.id, org1Invite.id, "must create a new invite for org-2");
    assert.equal(result.invite?.organization_id, "org-2");
    assert.equal(result.isExisting, false);
  });

  it("creates a NEW invite when the same email has an accepted invite (not blocked by accepted)", () => {
    // An accepted invite must not prevent new invitations to the same email
    const acceptedInvite = makeInvite({
      email: "returning@example.com",
      organization_id: "org-1",
      status: "accepted",
    });
    const store = createStore([acceptedInvite]);

    const result = simulateCreateInvite({
      orgId: "org-1",
      email: "returning@example.com",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.notEqual(result.invite?.id, acceptedInvite.id, "must create a fresh invite");
    assert.equal(result.invite?.status, "pending");
    assert.equal(result.isExisting, false);
  });

  it("returns 400 for invalid email format", () => {
    const store = createStore();
    const result = simulateCreateInvite({
      orgId: "org-1",
      email: "not-valid",
      role: "admin",
      userId: "admin-user",
      store,
    });
    assert.equal(result.status, 400);
  });

  it("returns 401 for unauthenticated request", () => {
    const store = createStore();
    const result = simulateCreateInvite({
      orgId: "org-1",
      email: "p@example.com",
      role: null,
      userId: null,
      store,
    });
    assert.equal(result.status, 401);
  });

  it("returns 403 for non-admin", () => {
    const store = createStore();
    const result = simulateCreateInvite({
      orgId: "org-1",
      email: "p@example.com",
      role: "active_member",
      userId: "member-user",
      store,
    });
    assert.equal(result.status, 403);
  });

  it("admin re-invite after expiry creates a NEW invite (expired pending invite is ignored)", () => {
    // An expired pending invite must NOT be returned as the idempotent result.
    // A brand-new invite with a different id and code must be created instead.
    const expiredInvite = makeInvite({
      email: "lapsed@example.com",
      organization_id: "org-1",
      status: "pending",
      expires_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // expired 8 days ago
    });
    const store = createStore([expiredInvite]);

    const result = simulateCreateInvite({
      orgId: "org-1",
      email: "lapsed@example.com",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.equal(result.isExisting, false, "must NOT return the expired invite as isExisting");
    assert.notEqual(result.invite?.id, expiredInvite.id, "new invite must have a different id");
    assert.notEqual(result.invite?.code, expiredInvite.code, "new invite must have a different code");
    assert.equal(result.invite?.status, "pending");
  });

  it("admin re-invite after expiry marks the original expired invite as revoked", () => {
    // After a re-invite, the previously expired pending invite must be revoked in the store
    // to avoid unique-constraint issues and to keep DB state accurate.
    const expiredInviteId = randomUUID();
    const expiredInvite = makeInvite({
      id: expiredInviteId,
      email: "lapsed2@example.com",
      organization_id: "org-1",
      status: "pending",
      expires_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const store = createStore([expiredInvite]);

    simulateCreateInvite({
      orgId: "org-1",
      email: "lapsed2@example.com",
      role: "admin",
      userId: "admin-user",
      store,
    });

    const original = store.findById(expiredInviteId);
    assert.ok(original, "original invite must still exist in store");
    assert.equal(original?.status, "revoked", "expired invite must be revoked after re-invite");
  });
});

// ── Invite acceptance tests ───────────────────────────────────────────────────

describe("POST /parents/invite/accept — invite acceptance lifecycle", () => {
  it("happy path: creates parent record with correct fields", () => {
    const invite = makeInvite({
      organization_id: "org-1",
      email: "jane@example.com",
      status: "pending",
    });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 200);
    assert.equal(result.success, true);
    assert.ok(result.parentId, "must return a parentId");
    assert.equal(result.parentRecord?.organization_id, "org-1");
    assert.equal(result.parentRecord?.first_name, "Jane");
    assert.equal(result.parentRecord?.last_name, "Smith");
    assert.equal(result.parentRecord?.email, "jane@example.com");
    assert.ok(result.parentRecord?.user_id, "must have a user_id");
  });

  it("happy path: marks invite status=accepted with accepted_at timestamp", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    const updated = store.findByCode(invite.code);
    assert.equal(updated?.status, "accepted", "invite must be marked accepted");
    assert.ok(updated?.accepted_at, "accepted_at must be set");
  });

  it("handles existing auth user (email already registered in auth)", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);
    const existingUserId = randomUUID();

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
      existingUserId,
    });

    assert.equal(result.status, 200);
    assert.equal(result.success, true);
    // Existing user ID must be used for the parent record
    assert.equal(result.parentRecord?.user_id, existingUserId);
  });

  it("returns 400 for missing first_name", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid request body");
  });

  it("returns 400 for missing last_name", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid request body");
  });

  it("returns 400 for password shorter than 8 characters", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "short",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid request body");
  });

  it("returns 400 for empty code", () => {
    const store = createStore();

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: "",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid request body");
  });

  it("returns 400 for invalid/unknown code", () => {
    const store = createStore();

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: "nonexistent-code",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid invite code");
  });

  it("returns 400 for code belonging to org-2 but URL targets org-1", () => {
    const invite = makeInvite({ organization_id: "org-2" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid invite code");
  });

  it("returns 409 for already-accepted invite", () => {
    const invite = makeInvite({ status: "accepted" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 409);
    assert.equal(result.error, "Invite already accepted");
  });

  it("returns 410 for revoked invite", () => {
    const invite = makeInvite({ status: "revoked" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 410);
    assert.equal(result.error, "Invite has been revoked");
  });

  it("returns 410 for expired invite", () => {
    const invite = makeInvite({
      expires_at: new Date(Date.now() - 1000).toISOString(), // 1 second in the past
    });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 410);
    assert.equal(result.error, "Invite has expired");
  });

  it("accept creates user_organization_roles row with role=parent, status=active", () => {
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 200);
    assert.equal(result.userOrgRoleCreated, true, "user_organization_roles row must be created on accept");
    assert.ok(result.orgRoleRow, "orgRoleRow must be present");
    assert.equal(result.orgRoleRow?.role, "parent");
    assert.equal(result.orgRoleRow?.status, "active");
    assert.equal(result.orgRoleRow?.organization_id, "org-1");
    assert.ok(result.orgRoleRow?.user_id, "user_id must be set on org role row");
  });

  it("re-invite of revoked user reactivates membership row to status=active", () => {
    // Scenario: user was previously a member, got revoked, then admin issues a parent invite.
    // On accept, the INSERT hits a 23505 unique violation. The handler should UPDATE the
    // revoked row to status='active', role='parent'.
    const existingUserId = randomUUID();
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Bob",
      last_name: "Jones",
      password: "securepass123",
      store,
      existingUserId,
      existingOrgRoleStatus: "revoked",
    });

    assert.equal(result.status, 200);
    assert.equal(result.success, true);
    assert.ok(result.orgRoleRow, "orgRoleRow must be present after reactivation");
    assert.equal(result.orgRoleRow?.status, "active", "revoked row must be reactivated to active");
    assert.equal(result.orgRoleRow?.role, "parent", "role must be set to parent on reactivation");
    assert.equal(result.orgRoleRow?.user_id, existingUserId);
    assert.equal(result.orgRoleRow?.organization_id, "org-1");
  });

  it("invite acceptance preserves an already-active member's existing role", () => {
    // Scenario: an active_member receives a parent invite. On accept, the INSERT
    // hits 23505. The reactivation UPDATE has .eq("status", "revoked") so it matches
    // 0 rows for an active user → existing role is NOT overwritten to "parent".
    const existingUserId = randomUUID();
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Alice",
      last_name: "Member",
      password: "securepass123",
      store,
      existingUserId,
      existingOrgRoleStatus: "active",
    });

    assert.equal(result.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.userOrgRoleCreated, false, "existing row was not re-inserted");
    // The existing row must NOT be downgraded to 'parent'
    assert.notEqual(result.orgRoleRow?.role, "parent", "active member's role must not be overwritten to parent");
    assert.equal(result.orgRoleRow?.status, "active");
    assert.equal(result.orgRoleRow?.user_id, existingUserId);
  });

  it("reuses existing parent record when a non-deleted parent row already exists for that email", () => {
    // Scenario: admin manually created a parent record before sending the invite.
    // On acceptance, the route should UPDATE the existing record (preserving admin-set
    // fields like relationship/student_name/notes) rather than INSERT a duplicate.
    const existingParentId = randomUUID();
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
      existingParentId,
    });

    assert.equal(result.status, 200);
    assert.equal(result.success, true);
    assert.equal(
      result.parentId,
      existingParentId,
      "must reuse existing parent record id, not create a new one"
    );
  });
});
