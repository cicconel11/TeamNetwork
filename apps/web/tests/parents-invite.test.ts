/**
 * Parents invite — role normalization + invite lifecycle tests
 *
 * Combines:
 * 1. Role normalization suite (ported from parent-invite.test.ts)
 * 2. Invite creation lifecycle (no email required, each call creates a fresh code)
 * 3. Invite acceptance lifecycle (email in body, user creation, parent row creation)
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
    all() {
      return [...invites];
    },
  };
}

// ── 3. Invite creation simulation ────────────────────────────────────────────

interface CreateInviteOptions {
  orgId: string;
  role: "admin" | "active_member" | "alumni" | null;
  userId: string | null;
  store: ReturnType<typeof createStore>;
  expiresAt?: string | null;
}

interface CreateInviteResult {
  status: number;
  invite?: Partial<ParentInvite>;
  error?: string;
}

function simulateCreateInvite(opts: CreateInviteOptions): CreateInviteResult {
  if (!opts.userId) return { status: 401, error: "Unauthorized" };
  if (opts.role !== "admin") return { status: 403, error: "Forbidden" };

  // P3 deduplication: return existing non-expired pending invite if one exists for this org.
  const now = new Date();
  const existing = opts.store.all().find(
    (i) =>
      i.organization_id === opts.orgId &&
      i.status === "pending" &&
      new Date(i.expires_at) > now
  );
  if (existing) {
    return { status: 200, invite: existing };
  }

  const invite = makeInvite({
    id: randomUUID(),
    organization_id: opts.orgId,
    code: randomUUID().replace(/-/g, ""),
    invited_by: opts.userId,
    status: "pending",
    ...(opts.expiresAt ? { expires_at: opts.expiresAt } : {}),
  });

  opts.store.add(invite);
  return { status: 200, invite };
}

// ── 4. Invite acceptance simulation ──────────────────────────────────────────

interface AcceptInviteOptions {
  orgId: string;
  code: string;
  email?: string;
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
  /**
   * When true, simulates the TOCTOU race condition where this request read the
   * invite as 'pending' (initial status checks passed) but by the time the atomic
   * claim UPDATE runs, another concurrent request has already claimed it
   * (UPDATE WHERE status='pending' returns 0 rows → 409).
   * Tests that the claim-first fix prevents both requests from proceeding.
   */
  raceConditionAlreadyClaimed?: boolean;
  /**
   * When true, simulates auth.admin.createUser throwing a transient/unexpected error
   * (not email-exists). The route must roll back the invite to 'pending' so the
   * parent can retry without admin intervention.
   */
  simulateTransientUserCreationError?: boolean;
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
  if (!opts.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.email)) {
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

  // Claim-first (mirrors route's atomic UPDATE WHERE status='pending').
  // If a concurrent request already claimed the invite, return 409 immediately
  // — before creating any auth user or parent record.
  if (opts.raceConditionAlreadyClaimed) {
    return { status: 409, error: "Invite already accepted" };
  }

  // Mark invite as accepted now (before user/parent creation), mirroring the route.
  // This ensures the invite is atomically reserved even if subsequent steps fail.
  opts.store.update(invite.id, {
    status: "accepted",
    accepted_at: new Date().toISOString(),
  });

  // User creation (simulate auth.admin.createUser) — uses email from body.
  // Patch 2: if email is already registered in auth, return 409 (no silent linking).
  if (opts.existingUserId !== undefined && opts.existingUserId !== null) {
    return {
      status: 409,
      error: "This email is already registered. Please sign in to accept this invite.",
    };
  }

  // Transient/unexpected user creation failure: roll back the invite claim to 'pending'
  // so the parent can retry without admin intervention (P0 TOCTOU rollback fix).
  if (opts.simulateTransientUserCreationError) {
    opts.store.update(invite.id, { status: "pending", accepted_at: null });
    return { status: 500, error: "Failed to create user account. Please try again." };
  }

  const userId = randomUUID();

  // Upsert parent record: reuse existing id if present (mirrors route's lookup-then-update-or-insert).
  const parentId = opts.existingParentId ?? randomUUID();
  const parentRecord: ParentRecord = {
    id: parentId,
    organization_id: invite.organization_id,
    user_id: userId,
    first_name: opts.first_name!,
    last_name: opts.last_name!,
    email: opts.email,
  };

  // Simulate user_organization_roles INSERT / reactivation logic.
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
  it("admin receives a new pending invite with id, code, and status (no email required)", () => {
    const store = createStore();
    const result = simulateCreateInvite({
      orgId: "org-1",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.ok(result.invite?.id, "invite must have an id");
    assert.ok(result.invite?.code, "invite must have a code");
    assert.equal(result.invite?.status, "pending");
  });

  it("returns the existing pending invite on repeated calls (idempotent)", () => {
    // P3 fix: POST /invite is now idempotent when a non-expired pending invite exists
    // for the same org. The same invite is returned instead of creating a duplicate row.
    const store = createStore();

    const result1 = simulateCreateInvite({
      orgId: "org-1",
      role: "admin",
      userId: "admin-user",
      store,
    });

    const result2 = simulateCreateInvite({
      orgId: "org-1",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result1.status, 200);
    assert.equal(result2.status, 200);
    assert.equal(result1.invite?.id, result2.invite?.id, "same invite must be returned on repeated POST");
    assert.equal(result1.invite?.code, result2.invite?.code, "same code must be returned on repeated POST");
    assert.equal(store.all().length, 1, "only one invite row should exist in the store");
  });

  it("creates a new invite when the existing pending invite has expired", () => {
    const store = createStore();

    // Seed an expired pending invite
    const expiredInvite = makeInvite({
      organization_id: "org-1",
      status: "pending",
      expires_at: new Date(Date.now() - 1000).toISOString(), // 1 second in the past
    });
    store.add(expiredInvite);

    const result = simulateCreateInvite({
      orgId: "org-1",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.notEqual(result.invite?.id, expiredInvite.id, "must create a fresh invite, not return expired one");
    assert.equal(store.all().length, 2, "both the expired and new invite exist in the store");
  });

  it("creates a new invite when the existing invite has been accepted", () => {
    const store = createStore();

    // Seed an already-accepted invite
    const acceptedInvite = makeInvite({ organization_id: "org-1", status: "accepted" });
    store.add(acceptedInvite);

    const result = simulateCreateInvite({
      orgId: "org-1",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result.status, 200);
    assert.notEqual(result.invite?.id, acceptedInvite.id, "must create a new invite after accepted one");
    assert.equal(result.invite?.status, "pending");
  });

  it("creates invites independently for different orgs", () => {
    const store = createStore();

    const result1 = simulateCreateInvite({
      orgId: "org-1",
      role: "admin",
      userId: "admin-user",
      store,
    });

    const result2 = simulateCreateInvite({
      orgId: "org-2",
      role: "admin",
      userId: "admin-user",
      store,
    });

    assert.equal(result1.status, 200);
    assert.equal(result2.status, 200);
    assert.equal(result1.invite?.organization_id, "org-1");
    assert.equal(result2.invite?.organization_id, "org-2");
    assert.notEqual(result1.invite?.code, result2.invite?.code);
  });

  it("returns 401 for unauthenticated request", () => {
    const store = createStore();
    const result = simulateCreateInvite({
      orgId: "org-1",
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
      role: "active_member",
      userId: "member-user",
      store,
    });
    assert.equal(result.status, 403);
  });

  it("respects custom expires_at when provided", () => {
    const store = createStore();
    const customExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = simulateCreateInvite({
      orgId: "org-1",
      role: "admin",
      userId: "admin-user",
      store,
      expiresAt: customExpiry,
    });

    assert.equal(result.status, 200);
    assert.equal(result.invite?.expires_at, customExpiry);
  });
});

// ── Invite acceptance tests ───────────────────────────────────────────────────

describe("POST /parents/invite/accept — invite acceptance lifecycle", () => {
  it("happy path: creates parent record with email from body (not from invite)", () => {
    const invite = makeInvite({
      organization_id: "org-1",
      status: "pending",
    });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
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
    assert.equal(result.parentRecord?.email, "jane@example.com", "email on parent record comes from body");
    assert.ok(result.parentRecord?.user_id, "must have a user_id");
  });

  it("happy path: marks invite status=accepted with accepted_at timestamp", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    const updated = store.findByCode(invite.code);
    assert.equal(updated?.status, "accepted", "invite must be marked accepted");
    assert.ok(updated?.accepted_at, "accepted_at must be set");
  });

  it("returns 409 when email is already registered — silent linking is prevented (Patch 2)", () => {
    // An invite holder must not be able to grant org membership to an email they don't own.
    // If the email already exists in auth, the caller must sign in to accept (future feature).
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);
    const existingUserId = randomUUID();

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "existing@example.com",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
      existingUserId,
    });

    assert.equal(result.status, 409);
    assert.ok(result.error?.includes("already registered"), "error must mention 'already registered'");
  });

  it("returns 400 for missing email", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid request body");
  });

  it("returns 400 for invalid email format", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "not-an-email",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid request body");
  });

  it("returns 400 for missing first_name", () => {
    const invite = makeInvite({ status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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
      email: "jane@example.com",
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

  it("revoked parent with existing auth account gets 409 — must sign in to accept new invite", () => {
    // A parent whose access was revoked and who already has an auth account cannot accept a
    // new invite via the unauthenticated endpoint. They must sign in (future feature).
    const existingUserId = randomUUID();
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "bob@example.com",
      first_name: "Bob",
      last_name: "Jones",
      password: "securepass123",
      store,
      existingUserId,
      existingOrgRoleStatus: "revoked",
    });

    assert.equal(result.status, 409);
    assert.ok(result.error?.includes("already registered"), "must prompt to sign in");
  });

  it("active member who submits their email on a parent invite gets 409 — must sign in to accept", () => {
    // An active member's email is already registered. The unauthenticated endpoint must not
    // silently grant them a parent role without their knowledge. They must sign in (future feature).
    const existingUserId = randomUUID();
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "alice@example.com",
      first_name: "Alice",
      last_name: "Member",
      password: "securepass123",
      store,
      existingUserId,
      existingOrgRoleStatus: "active",
    });

    assert.equal(result.status, 409);
    assert.ok(result.error?.includes("already registered"), "must prompt to sign in");
  });

  it("reuses existing parent record when a non-deleted parent row already exists for that email", () => {
    const existingParentId = randomUUID();
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
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

  it("two different parents can redeem the same invite code (same email — different scenario)", () => {
    // The invite has no email; any parent can redeem with their own email.
    // The second redemption of an already-accepted invite should return 409.
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    // First redemption
    const result1 = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "parent-a@example.com",
      first_name: "Parent",
      last_name: "A",
      password: "securepass123",
      store,
    });
    assert.equal(result1.status, 200);

    // Second attempt on same (now accepted) invite
    const result2 = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "parent-b@example.com",
      first_name: "Parent",
      last_name: "B",
      password: "securepass123",
      store,
    });
    assert.equal(result2.status, 409, "second redemption of same invite must fail with 409");
  });
});

// ── TOCTOU race condition (Issue B) ───────────────────────────────────────────

describe("POST /parents/invite/accept — claim-first TOCTOU protection", () => {
  it("invite is claimed before user creation — invite.status=accepted in store after first request", () => {
    // Verifies the claim happens early (before user/parent creation), not at the end.
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });

    assert.equal(result.status, 200);
    assert.ok(result.parentId, "parent record must be created");
    // Claim-first: the invite must be marked accepted before user/parent creation,
    // so the store reflects this immediately after the call.
    const updated = store.findByCode(invite.code);
    assert.equal(updated?.status, "accepted", "invite must be claimed during processing");
    assert.ok(updated?.accepted_at, "accepted_at must be set");
  });

  it("returns 409 when concurrent request wins the atomic claim (race condition simulation)", () => {
    // Scenario 7 from security audit: two simultaneous requests both read status='pending'
    // and pass initial checks, but only one can win the atomic UPDATE WHERE status='pending'.
    // The loser gets 0 rows back and returns 409 without creating any user or parent record.
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    // Request A: fully completes (wins the claim).
    const resultA = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "parent-a@example.com",
      first_name: "Parent",
      last_name: "A",
      password: "securepass123",
      store,
    });
    assert.equal(resultA.status, 200, "first concurrent request must succeed");
    assert.equal(store.findByCode(invite.code)?.status, "accepted");

    // Request B: read 'pending' concurrently with A, passed initial checks, but loses
    // the atomic claim because A already updated the row. raceConditionAlreadyClaimed
    // simulates the DB returning 0 rows from UPDATE WHERE status='pending'.
    const resultB = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "parent-b@example.com",
      first_name: "Parent",
      last_name: "B",
      password: "securepass123",
      store,
      raceConditionAlreadyClaimed: true,
    });
    assert.equal(resultB.status, 409, "losing concurrent request must return 409");
    assert.equal(resultB.error, "Invite already accepted");
  });

  it("returns 500 and invite is retryable when user creation fails with transient error", () => {
    // P0 TOCTOU rollback fix: if auth.admin.createUser() throws an unexpected error
    // (Supabase rate limit, transient 500, network error), the route rolls back the
    // invite claim to 'pending' so the parent can retry without admin intervention.
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    const result = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
      simulateTransientUserCreationError: true,
    });

    assert.equal(result.status, 500, "must return 500 on transient user creation failure");
    assert.ok(result.error?.includes("Please try again"), "error must be retryable message");

    // Critical: invite must be rolled back to 'pending' so the parent can retry.
    const inviteAfter = store.findByCode(invite.code);
    assert.equal(inviteAfter?.status, "pending", "invite must be rolled back to pending on failure");
    assert.equal(inviteAfter?.accepted_at, null, "accepted_at must be cleared on rollback");
  });

  it("retryable: a second attempt succeeds after a transient user-creation failure", () => {
    // Confirms the full retry cycle: fail → rollback → retry → success.
    const invite = makeInvite({ organization_id: "org-1", status: "pending" });
    const store = createStore([invite]);

    // First attempt: transient failure
    const attempt1 = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
      simulateTransientUserCreationError: true,
    });
    assert.equal(attempt1.status, 500);
    assert.equal(store.findByCode(invite.code)?.status, "pending", "invite is pending after rollback");

    // Second attempt: success
    const attempt2 = simulateAcceptInvite({
      orgId: "org-1",
      code: invite.code,
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepass123",
      store,
    });
    assert.equal(attempt2.status, 200, "retry must succeed after rollback");
    assert.equal(attempt2.success, true);
    assert.ok(attempt2.parentId, "must return parentId on retry");
    assert.equal(store.findByCode(invite.code)?.status, "accepted", "invite accepted after retry");
  });
});
