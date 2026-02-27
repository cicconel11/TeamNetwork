import { describe, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "crypto";

/**
 * Tests for org-scoped parents API routes:
 *   GET  /api/organizations/[organizationId]/parents
 *   POST /api/organizations/[organizationId]/parents
 *   PATCH  /api/organizations/[organizationId]/parents/[parentId]
 *   DELETE /api/organizations/[organizationId]/parents/[parentId]
 *   POST /api/organizations/[organizationId]/parents/invite
 *   POST /api/organizations/[organizationId]/parents/invite/accept
 *
 * Tests simulate route handler logic without making real HTTP calls.
 * This matches the project-wide testing pattern (see tests/routes/organizations/management.test.ts).
 */

// ── Shared types ──────────────────────────────────────────────────────────────

type OrgRole = "admin" | "active_member" | "alumni" | "parent" | null;

interface ParentRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
  photo_url: string | null;
  relationship: string | null;
  student_name: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface ParentInviteRow {
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

function makeParent(overrides: Partial<ParentRow> = {}): ParentRow {
  return {
    id: randomUUID(),
    organization_id: "org-1",
    user_id: null,
    first_name: "Jane",
    last_name: "Smith",
    email: "jane@example.com",
    phone_number: null,
    photo_url: null,
    relationship: "mother",
    student_name: null,
    notes: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeInvite(overrides: Partial<ParentInviteRow> = {}): ParentInviteRow {
  return {
    id: randomUUID(),
    organization_id: "org-1",
    email: "parent@example.com",
    code: "abc123",
    invited_by: "admin-user",
    status: "pending",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── GET /parents simulation ───────────────────────────────────────────────────

interface GetParentsRequest {
  userId: string | null;
  role: OrgRole;
  parents: ParentRow[];
  search?: string;
  relationship?: string;
  student_name?: string;
  limit?: number;
  offset?: number;
}

interface GetParentsResult {
  status: number;
  parents?: unknown[];
  total?: number;
  error?: string;
}

function simulateGetParents(req: GetParentsRequest): GetParentsResult {
  if (!req.userId) return { status: 401, error: "Unauthorized" };

  // Mirrors route: admin, active_member, and parent can read the parents directory.
  const canRead =
    req.role === "admin" || req.role === "active_member" || req.role === "parent";
  if (!canRead) return { status: 403, error: "Forbidden" };

  const limit = req.limit ?? 50;
  const offset = req.offset ?? 0;

  let rows = req.parents.filter((p) => p.deleted_at === null);

  if (req.search) {
    const q = req.search.toLowerCase();
    rows = rows.filter(
      (p) =>
        p.first_name.toLowerCase().includes(q) ||
        p.last_name.toLowerCase().includes(q)
    );
  }

  if (req.relationship) {
    rows = rows.filter((p) => p.relationship === req.relationship);
  }

  if (req.student_name) {
    const q = req.student_name.toLowerCase();
    rows = rows.filter((p) => p.student_name?.toLowerCase().includes(q));
  }

  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  // Simulate column projection (no deleted_at, user_id in response)
  const projected = page.map(({ id, first_name, last_name, email, phone_number, photo_url, relationship, student_name, notes, created_at }) => ({
    id, first_name, last_name, email, phone_number, photo_url, relationship, student_name, notes, created_at,
  }));

  return { status: 200, parents: projected, total };
}

// ── POST /parents simulation ──────────────────────────────────────────────────

interface CreateParentRequest {
  userId: string | null;
  role: OrgRole;
  body: {
    first_name?: unknown;
    last_name?: unknown;
    email?: unknown;
    phone_number?: unknown;
    photo_url?: unknown;
    relationship?: unknown;
    notes?: unknown;
  };
  dbError?: boolean;
}

interface CreateParentResult {
  status: number;
  parent?: Partial<ParentRow>;
  error?: string;
}

function simulateCreateParent(req: CreateParentRequest): CreateParentResult {
  if (!req.userId) return { status: 401, error: "Unauthorized" };
  if (req.role !== "admin") return { status: 403, error: "Forbidden" };

  // Validate required fields
  if (!req.body.first_name || typeof req.body.first_name !== "string" || !req.body.first_name.trim()) {
    return { status: 400, error: "Invalid request body" };
  }
  if (!req.body.last_name || typeof req.body.last_name !== "string" || !req.body.last_name.trim()) {
    return { status: 400, error: "Invalid request body" };
  }
  if (req.body.email !== undefined && req.body.email !== null) {
    if (typeof req.body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email as string)) {
      return { status: 400, error: "Invalid request body" };
    }
  }

  if (req.dbError) return { status: 500, error: "Internal server error" };

  const parent: Partial<ParentRow> = {
    id: randomUUID(),
    organization_id: "org-1",
    first_name: req.body.first_name as string,
    last_name: req.body.last_name as string,
    email: (req.body.email as string | undefined) ?? null,
    phone_number: (req.body.phone_number as string | undefined) ?? null,
    photo_url: (req.body.photo_url as string | undefined) ?? null,
    relationship: (req.body.relationship as string | undefined) ?? null,
    notes: (req.body.notes as string | undefined) ?? null,
    created_at: new Date().toISOString(),
  };

  return { status: 201, parent };
}

// ── PATCH /parents/[parentId] simulation ──────────────────────────────────────

interface UpdateParentRequest {
  userId: string | null;
  role: OrgRole;
  /** Whether the user has an active membership row (null role = no row at all) */
  membershipActive?: boolean;
  parentId: string;
  parentExists: boolean;
  /** user_id stored on the parent record (null = not linked to any auth user) */
  parentUserId?: string | null;
  body: Partial<ParentRow>;
  dbError?: boolean;
}

interface UpdateParentResult {
  status: number;
  parent?: Partial<ParentRow>;
  error?: string;
}

function simulateUpdateParent(req: UpdateParentRequest): UpdateParentResult {
  if (!req.userId) return { status: 401, error: "Unauthorized" };
  if (!req.parentExists) return { status: 404, error: "Parent not found" };
  const isAdmin = req.role === "admin";
  // isSelf requires an active membership row AND the record being linked to this user
  const hasMembership = req.role !== null && req.membershipActive !== false;
  const isSelf = hasMembership && req.parentUserId != null && req.userId === req.parentUserId;
  if (!isAdmin && !isSelf) return { status: 403, error: "Forbidden" };
  if (req.dbError) return { status: 500, error: "Internal server error" };

  const parent: Partial<ParentRow> = {
    id: req.parentId,
    organization_id: "org-1",
    first_name: req.body.first_name ?? "Jane",
    last_name: req.body.last_name ?? "Smith",
    email: req.body.email ?? null,
    phone_number: req.body.phone_number ?? null,
    photo_url: req.body.photo_url ?? null,
    relationship: req.body.relationship ?? null,
    notes: req.body.notes ?? null,
    created_at: new Date().toISOString(),
  };

  return { status: 200, parent };
}

// ── DELETE /parents/[parentId] simulation ─────────────────────────────────────

interface DeleteParentRequest {
  userId: string | null;
  role: OrgRole;
  parentId: string;
  parentExists: boolean;
  dbError?: boolean;
}

interface DeleteParentResult {
  status: number;
  success?: boolean;
  error?: string;
}

function simulateDeleteParent(req: DeleteParentRequest): DeleteParentResult {
  if (!req.userId) return { status: 401, error: "Unauthorized" };
  if (req.role !== "admin") return { status: 403, error: "Forbidden" };
  if (!req.parentExists) return { status: 404, error: "Parent not found" };
  if (req.dbError) return { status: 500, error: "Internal server error" };
  return { status: 200, success: true };
}

// ── POST /parents/invite simulation ───────────────────────────────────────────

interface CreateInviteRequest {
  userId: string | null;
  role: OrgRole;
  email: string;
  existingPendingInvite?: ParentInviteRow | null;
  dbError?: boolean;
}

interface CreateInviteResult {
  status: number;
  invite?: Partial<ParentInviteRow>;
  error?: string;
}

function simulateCreateInvite(req: CreateInviteRequest): CreateInviteResult {
  if (!req.userId) return { status: 401, error: "Unauthorized" };
  if (req.role !== "admin") return { status: 403, error: "Forbidden" };

  if (typeof req.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.email)) {
    return { status: 400, error: "Invalid request body" };
  }

  // Idempotent: return existing pending invite if found
  if (req.existingPendingInvite) {
    return { status: 200, invite: req.existingPendingInvite };
  }

  if (req.dbError) return { status: 500, error: "Failed to create invite" };

  const invite: Partial<ParentInviteRow> = {
    id: randomUUID(),
    organization_id: "org-1",
    email: req.email,
    code: "newcode123",
    status: "pending",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: null,
  };

  return { status: 200, invite };
}

// ── PATCH /parents/invite/[inviteId] simulation ───────────────────────────────

type InviteOrFetchError = ParentInviteRow | null | "fetch_error";

interface RevokeInviteRequest {
  organizationId: string;
  inviteId: string;
  userId: string | null;
  role: OrgRole;
  invite: InviteOrFetchError;
  updateError?: boolean;
}

interface RevokeInviteResult {
  status: number;
  success?: boolean;
  error?: string;
}

function simulateRevokeInvite(req: RevokeInviteRequest): RevokeInviteResult {
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_PATTERN.test(req.organizationId)) {
    return { status: 400, error: "Invalid organization id" };
  }
  if (!UUID_PATTERN.test(req.inviteId)) {
    return { status: 400, error: "Invalid invite id" };
  }

  if (!req.userId) return { status: 401, error: "Unauthorized" };
  if (req.role !== "admin") return { status: 403, error: "Forbidden" };

  if (req.invite === "fetch_error") {
    return { status: 500, error: "Failed to fetch invite" };
  }
  if (!req.invite) return { status: 404, error: "Invite not found" };

  if (req.invite.status === "accepted") {
    return { status: 409, error: "Invite already accepted — cannot revoke" };
  }
  if (req.invite.status === "revoked") {
    return { status: 200, success: true };
  }

  if (req.updateError) return { status: 500, error: "Failed to revoke invite" };

  return { status: 200, success: true };
}

// ── POST /parents/invite/accept simulation ────────────────────────────────────

interface AcceptInviteRequest {
  code: string;
  first_name: string;
  last_name: string;
  password: string;
  invite?: ParentInviteRow | null;
  orgId?: string;
  userCreateError?: string | null;
  existingUserId?: string | null;
  dbError?: boolean;
}

interface AcceptInviteResult {
  status: number;
  success?: boolean;
  parentId?: string;
  error?: string;
}

function simulateAcceptInvite(req: AcceptInviteRequest): AcceptInviteResult {
  // Validate body
  if (!req.code || req.code.length < 1) return { status: 400, error: "Invalid request body" };
  if (!req.first_name?.trim()) return { status: 400, error: "Invalid request body" };
  if (!req.last_name?.trim()) return { status: 400, error: "Invalid request body" };
  if (!req.password || req.password.length < 8) return { status: 400, error: "Invalid request body" };

  if (!req.invite) return { status: 400, error: "Invalid invite code" };

  // Org mismatch check
  if (req.orgId && req.invite.organization_id !== req.orgId) {
    return { status: 400, error: "Invalid invite code" };
  }

  if (req.invite.status === "accepted") return { status: 409, error: "Invite already accepted" };
  if (req.invite.status === "revoked") return { status: 410, error: "Invite has been revoked" };
  if (new Date(req.invite.expires_at) < new Date()) return { status: 410, error: "Invite has expired" };

  // User creation — handle existing user
  if (req.userCreateError && !req.existingUserId) {
    return { status: 500, error: "Failed to create user account" };
  }

  if (req.dbError) return { status: 500, error: "Failed to create parent record" };

  return { status: 200, success: true, parentId: randomUUID() };
}

// ── GET /parents tests ────────────────────────────────────────────────────────

describe("GET /api/organizations/[organizationId]/parents", () => {
  it("returns 401 for unauthenticated request", () => {
    const result = simulateGetParents({ userId: null, role: null, parents: [] });
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  it("returns 403 for alumni role", () => {
    const result = simulateGetParents({ userId: "u1", role: "alumni", parents: [] });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("returns 200 for parent role (parent-role user can read the parents directory)", () => {
    // RLS fix 20260616000000 added 'parent' to the SELECT policy; route must match.
    const result = simulateGetParents({ userId: "u1", role: "parent", parents: [] });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.parents, []);
    assert.strictEqual(result.total, 0);
  });

  it("returns 403 for authenticated user with no membership in this org (role=null)", () => {
    // Covers Scenario 1 cross-org attack: user from org-A tries org-B; getOrgMemberRole returns null.
    const result = simulateGetParents({ userId: "u1", role: null, parents: [] });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("returns 200 with empty array when no parents exist", () => {
    const result = simulateGetParents({ userId: "u1", role: "active_member", parents: [] });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.parents, []);
    assert.strictEqual(result.total, 0);
  });

  it("returns 200 for admin", () => {
    const parents = [makeParent()];
    const result = simulateGetParents({ userId: "admin", role: "admin", parents });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.total, 1);
  });

  it("returns 200 for active_member", () => {
    const parents = [makeParent(), makeParent()];
    const result = simulateGetParents({ userId: "m1", role: "active_member", parents });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.total, 2);
  });

  it("excludes soft-deleted records", () => {
    const parents = [
      makeParent({ deleted_at: null }),
      makeParent({ deleted_at: new Date().toISOString() }),
    ];
    const result = simulateGetParents({ userId: "u1", role: "admin", parents });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.total, 1);
  });

  it("filters by search (first_name match)", () => {
    const parents = [
      makeParent({ first_name: "Alice", last_name: "Brown" }),
      makeParent({ first_name: "Bob", last_name: "Jones" }),
    ];
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, search: "alice" });
    assert.strictEqual(result.total, 1);
    assert.strictEqual((result.parents![0] as ParentRow).first_name, "Alice");
  });

  it("filters by search (last_name match)", () => {
    const parents = [
      makeParent({ first_name: "Alice", last_name: "Brown" }),
      makeParent({ first_name: "Bob", last_name: "Jones" }),
    ];
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, search: "jones" });
    assert.strictEqual(result.total, 1);
    assert.strictEqual((result.parents![0] as ParentRow).last_name, "Jones");
  });

  it("filters by relationship", () => {
    const parents = [
      makeParent({ relationship: "mother" }),
      makeParent({ relationship: "father" }),
      makeParent({ relationship: "mother" }),
    ];
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, relationship: "mother" });
    assert.strictEqual(result.total, 2);
    for (const p of result.parents!) {
      assert.strictEqual((p as ParentRow).relationship, "mother");
    }
  });

  it("does not expose deleted_at or user_id in response", () => {
    const parents = [makeParent({ user_id: "secret-user-id" })];
    const result = simulateGetParents({ userId: "u1", role: "admin", parents });
    assert.strictEqual(result.status, 200);
    const row = result.parents![0] as Record<string, unknown>;
    assert.ok(!("deleted_at" in row), "deleted_at must not appear in response");
    assert.ok(!("user_id" in row), "user_id must not appear in response");
  });

  it("paginates correctly with limit and offset", () => {
    const parents = Array.from({ length: 5 }, (_, i) =>
      makeParent({ last_name: `Person${i}` })
    );
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, limit: 2, offset: 2 });
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.parents!.length, 2);
  });

  // student_name is now a supported API param (parentsQuerySchema) — simulation and route in sync.
  it("student_name filter matches partial values", () => {
    const parents = [
      makeParent({ first_name: "Alice", last_name: "Brown", student_name: "Alex Smith" }),
      makeParent({ first_name: "Bob", last_name: "Jones", student_name: "Bob Jones" }),
    ];
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, student_name: "Alex" });
    assert.strictEqual(result.total, 1);
    assert.strictEqual((result.parents![0] as ParentRow).student_name, "Alex Smith");
  });

  it("student_name filter is case-insensitive", () => {
    const parents = [
      makeParent({ student_name: "alex smith" }),
    ];
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, student_name: "ALEX" });
    assert.strictEqual(result.total, 1);
    assert.strictEqual((result.parents![0] as ParentRow).student_name, "alex smith");
  });
});

// ── POST /parents tests ───────────────────────────────────────────────────────

describe("POST /api/organizations/[organizationId]/parents", () => {
  it("returns 401 for unauthenticated", () => {
    const result = simulateCreateParent({
      userId: null, role: null,
      body: { first_name: "A", last_name: "B" },
    });
    assert.strictEqual(result.status, 401);
  });

  it("returns 403 for active_member", () => {
    const result = simulateCreateParent({
      userId: "m1", role: "active_member",
      body: { first_name: "A", last_name: "B" },
    });
    assert.strictEqual(result.status, 403);
  });

  it("returns 403 for alumni", () => {
    const result = simulateCreateParent({
      userId: "a1", role: "alumni",
      body: { first_name: "A", last_name: "B" },
    });
    assert.strictEqual(result.status, 403);
  });

  it("returns 400 when first_name is missing", () => {
    const result = simulateCreateParent({
      userId: "admin", role: "admin",
      body: { last_name: "Smith" },
    });
    assert.strictEqual(result.status, 400);
  });

  it("returns 400 when last_name is missing", () => {
    const result = simulateCreateParent({
      userId: "admin", role: "admin",
      body: { first_name: "Jane" },
    });
    assert.strictEqual(result.status, 400);
  });

  it("returns 400 for invalid email", () => {
    const result = simulateCreateParent({
      userId: "admin", role: "admin",
      body: { first_name: "Jane", last_name: "Smith", email: "not-an-email" },
    });
    assert.strictEqual(result.status, 400);
  });

  it("returns 201 with created parent for admin", () => {
    const result = simulateCreateParent({
      userId: "admin", role: "admin",
      body: { first_name: "Jane", last_name: "Smith", email: "jane@example.com", relationship: "mother" },
    });
    assert.strictEqual(result.status, 201);
    assert.ok(result.parent?.id, "should have an id");
    assert.strictEqual(result.parent?.first_name, "Jane");
    assert.strictEqual(result.parent?.last_name, "Smith");
    assert.strictEqual(result.parent?.relationship, "mother");
  });

  it("returns 500 on DB error", () => {
    const result = simulateCreateParent({
      userId: "admin", role: "admin",
      body: { first_name: "Jane", last_name: "Smith" },
      dbError: true,
    });
    assert.strictEqual(result.status, 500);
  });
});

// ── PATCH /parents/[parentId] tests ──────────────────────────────────────────

describe("PATCH /api/organizations/[organizationId]/parents/[parentId]", () => {
  const parentId = randomUUID();

  it("returns 401 for unauthenticated", () => {
    const result = simulateUpdateParent({ userId: null, role: null, parentId, parentExists: true, body: {} });
    assert.strictEqual(result.status, 401);
  });

  it("returns 403 for active_member", () => {
    const result = simulateUpdateParent({ userId: "m1", role: "active_member", parentId, parentExists: true, body: {} });
    assert.strictEqual(result.status, 403);
  });

  it("returns 404 if parent not in org", () => {
    const result = simulateUpdateParent({ userId: "admin", role: "admin", parentId, parentExists: false, body: {} });
    assert.strictEqual(result.status, 404);
  });

  it("returns 200 with updated parent for admin", () => {
    const result = simulateUpdateParent({
      userId: "admin", role: "admin", parentId, parentExists: true,
      body: { first_name: "Updated", last_name: "Name", relationship: "guardian" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.parent?.first_name, "Updated");
    assert.strictEqual(result.parent?.relationship, "guardian");
  });

  it("returns 500 on DB error", () => {
    const result = simulateUpdateParent({
      userId: "admin", role: "admin", parentId, parentExists: true,
      body: { first_name: "Jane" }, dbError: true,
    });
    assert.strictEqual(result.status, 500);
  });

  it("parent can update their own record (isSelf)", () => {
    const selfUserId = randomUUID();
    const result = simulateUpdateParent({
      userId: selfUserId, role: "parent", parentId, parentExists: true,
      parentUserId: selfUserId,
      body: { first_name: "Updated" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.parent?.first_name, "Updated");
  });

  it("parent cannot update another parent's record", () => {
    const result = simulateUpdateParent({
      userId: randomUUID(), role: "parent", parentId, parentExists: true,
      parentUserId: randomUUID(),
      body: { first_name: "Hacked" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("parent with null user_id cannot self-edit (not linked to any auth user)", () => {
    const result = simulateUpdateParent({
      userId: randomUUID(), role: "parent", parentId, parentExists: true,
      parentUserId: null,
      body: { first_name: "Attempt" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("revoked user (linked) cannot self-edit — membershipActive=false → 403", () => {
    const selfUserId = randomUUID();
    const result = simulateUpdateParent({
      userId: selfUserId, role: "parent", membershipActive: false,
      parentId, parentExists: true,
      parentUserId: selfUserId,
      body: { first_name: "Revoked" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("non-member (no membership row) cannot self-edit even if record is linked", () => {
    const selfUserId = randomUUID();
    const result = simulateUpdateParent({
      userId: selfUserId, role: null, membershipActive: false,
      parentId, parentExists: true,
      parentUserId: selfUserId,
      body: { first_name: "Outsider" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });
});

// ── DELETE /parents/[parentId] tests ─────────────────────────────────────────

describe("DELETE /api/organizations/[organizationId]/parents/[parentId]", () => {
  const parentId = randomUUID();

  it("returns 401 for unauthenticated", () => {
    const result = simulateDeleteParent({ userId: null, role: null, parentId, parentExists: true });
    assert.strictEqual(result.status, 401);
  });

  it("returns 403 for active_member", () => {
    const result = simulateDeleteParent({ userId: "m1", role: "active_member", parentId, parentExists: true });
    assert.strictEqual(result.status, 403);
  });

  it("returns 404 if parent not in org or already deleted", () => {
    const result = simulateDeleteParent({ userId: "admin", role: "admin", parentId, parentExists: false });
    assert.strictEqual(result.status, 404);
  });

  it("soft-deletes parent and returns success", () => {
    const result = simulateDeleteParent({ userId: "admin", role: "admin", parentId, parentExists: true });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 500 on DB error", () => {
    const result = simulateDeleteParent({ userId: "admin", role: "admin", parentId, parentExists: true, dbError: true });
    assert.strictEqual(result.status, 500);
  });
});

// ── POST /parents/invite tests ────────────────────────────────────────────────

describe("POST /api/organizations/[organizationId]/parents/invite", () => {
  it("returns 401 for unauthenticated", () => {
    const result = simulateCreateInvite({ userId: null, role: null, email: "p@example.com" });
    assert.strictEqual(result.status, 401);
  });

  it("returns 403 for active_member", () => {
    const result = simulateCreateInvite({ userId: "m1", role: "active_member", email: "p@example.com" });
    assert.strictEqual(result.status, 403);
  });

  it("returns 400 for invalid email", () => {
    const result = simulateCreateInvite({ userId: "admin", role: "admin", email: "not-an-email" });
    assert.strictEqual(result.status, 400);
  });

  it("returns 200 with new invite for admin", () => {
    const result = simulateCreateInvite({ userId: "admin", role: "admin", email: "parent@example.com" });
    assert.strictEqual(result.status, 200);
    assert.ok(result.invite?.code, "invite should have a code");
    assert.strictEqual(result.invite?.email, "parent@example.com");
    assert.strictEqual(result.invite?.status, "pending");
  });

  it("is idempotent — returns existing pending invite on duplicate email", () => {
    const existingInvite = makeInvite({ email: "dup@example.com" });
    const result = simulateCreateInvite({
      userId: "admin", role: "admin",
      email: "dup@example.com",
      existingPendingInvite: existingInvite,
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.invite?.id, existingInvite.id);
    assert.strictEqual(result.invite?.code, existingInvite.code);
  });

  it("returns 500 on DB error", () => {
    const result = simulateCreateInvite({ userId: "admin", role: "admin", email: "p@example.com", dbError: true });
    assert.strictEqual(result.status, 500);
  });
});

// ── POST /parents/invite/accept tests ────────────────────────────────────────

describe("POST /api/organizations/[organizationId]/parents/invite/accept", () => {
  const validInvite = makeInvite();

  it("returns 400 for missing code", () => {
    const result = simulateAcceptInvite({
      code: "",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite: validInvite,
    });
    assert.strictEqual(result.status, 400);
  });

  it("returns 400 for password shorter than 8 chars", () => {
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "short",
      invite: validInvite,
    });
    assert.strictEqual(result.status, 400);
  });

  it("returns 400 for invalid/missing code (invite not found)", () => {
    const result = simulateAcceptInvite({
      code: "badcode",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite: null,
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid invite code");
  });

  it("returns 400 for org mismatch on invite", () => {
    const invite = makeInvite({ organization_id: "org-2" });
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite,
      orgId: "org-1",
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid invite code");
  });

  it("returns 409 for already-accepted invite", () => {
    const invite = makeInvite({ status: "accepted" });
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite,
    });
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.error, "Invite already accepted");
  });

  it("returns 410 for revoked invite", () => {
    const invite = makeInvite({ status: "revoked" });
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite,
    });
    assert.strictEqual(result.status, 410);
    assert.strictEqual(result.error, "Invite has been revoked");
  });

  it("returns 410 for expired invite", () => {
    const invite = makeInvite({
      expires_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    });
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite,
    });
    assert.strictEqual(result.status, 410);
    assert.strictEqual(result.error, "Invite has expired");
  });

  it("returns 200 and creates parent for valid invite", () => {
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite: validInvite,
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
    assert.ok(result.parentId, "should return a parentId");
  });

  it("links to existing user if email already exists in auth", () => {
    const existingUserId = randomUUID();
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite: validInvite,
      userCreateError: "User already registered",
      existingUserId,
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 500 if user creation fails and no existing user found", () => {
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite: validInvite,
      userCreateError: "Some unexpected error",
      existingUserId: null,
    });
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.error, "Failed to create user account");
  });

  it("returns 500 on parent DB insert error", () => {
    const result = simulateAcceptInvite({
      code: "abc123",
      first_name: "Jane",
      last_name: "Smith",
      password: "securepassword1",
      invite: validInvite,
      dbError: true,
    });
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.error, "Failed to create parent record");
  });
});

// ── PATCH /parents/invite/[inviteId] tests ────────────────────────────────────

describe("PATCH /api/organizations/[organizationId]/parents/invite/[inviteId]", () => {
  const validOrgId = randomUUID();
  const validInviteId = randomUUID();

  it("returns 401 for unauthenticated", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: null,
      role: null,
      invite: makeInvite(),
    });
    assert.strictEqual(result.status, 401);
  });

  it("returns 403 for active_member", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "m1",
      role: "active_member",
      invite: makeInvite(),
    });
    assert.strictEqual(result.status, 403);
  });

  it("returns 403 for parent role", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "p1",
      role: "parent",
      invite: makeInvite(),
    });
    assert.strictEqual(result.status, 403);
  });

  it("returns 400 for invalid organizationId UUID", () => {
    const result = simulateRevokeInvite({
      organizationId: "not-a-uuid",
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: makeInvite(),
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid organization id");
  });

  it("returns 400 for invalid inviteId UUID", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: "not-a-uuid",
      userId: "admin",
      role: "admin",
      invite: makeInvite(),
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid invite id");
  });

  it("returns 404 if invite not found", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: null,
    });
    assert.strictEqual(result.status, 404);
  });

  it("returns 404 if invite belongs to a different org (org-scoped DB query returns nothing)", () => {
    // Route queries .eq("organization_id", organizationId) — cross-org invite is invisible.
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: null, // org-scoped query returns no row for an invite owned by another org
    });
    assert.strictEqual(result.status, 404);
  });

  it("returns 409 if invite already accepted", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: makeInvite({ status: "accepted" }),
    });
    assert.strictEqual(result.status, 409);
    assert.ok(
      result.error?.includes("cannot revoke"),
      `expected 'cannot revoke' in error, got: ${result.error}`
    );
  });

  it("returns 200 (idempotent) if invite already revoked", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: makeInvite({ status: "revoked" }),
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 200 and revokes a pending invite", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: makeInvite({ status: "pending" }),
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 500 on DB fetch error", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: "fetch_error",
    });
    assert.strictEqual(result.status, 500);
  });

  it("returns 500 on DB update error", () => {
    const result = simulateRevokeInvite({
      organizationId: validOrgId,
      inviteId: validInviteId,
      userId: "admin",
      role: "admin",
      invite: makeInvite({ status: "pending" }),
      updateError: true,
    });
    assert.strictEqual(result.status, 500);
  });
});

// ── get_parents_relationship_options RPC simulation ───────────────────────────

/**
 * Simulates the get_parents_relationship_options DB function:
 *   SELECT DISTINCT relationship FROM parents
 *   WHERE organization_id = p_org_id AND deleted_at IS NULL AND relationship IS NOT NULL
 *   ORDER BY 1;
 */
function simulateGetRelationshipOptions(
  parents: Array<{ relationship: string | null; deleted_at: string | null }>
): string[] {
  const seen = new Set<string>();
  for (const p of parents) {
    if (p.deleted_at === null && p.relationship !== null) {
      seen.add(p.relationship);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

describe("get_parents_relationship_options RPC", () => {
  it("returns empty array when no parents exist", () => {
    const result = simulateGetRelationshipOptions([]);
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array when all relationships are null", () => {
    const rows = [
      { relationship: null, deleted_at: null },
      { relationship: null, deleted_at: null },
    ];
    const result = simulateGetRelationshipOptions(rows);
    assert.deepStrictEqual(result, []);
  });

  it("excludes soft-deleted rows from relationship options", () => {
    const rows = [
      { relationship: "mother", deleted_at: new Date().toISOString() },
      { relationship: "father", deleted_at: null },
    ];
    const result = simulateGetRelationshipOptions(rows);
    assert.deepStrictEqual(result, ["father"]);
  });

  it("deduplicates relationship values (DISTINCT)", () => {
    const rows = [
      { relationship: "mother", deleted_at: null },
      { relationship: "father", deleted_at: null },
      { relationship: "mother", deleted_at: null },
      { relationship: "mother", deleted_at: null },
    ];
    const result = simulateGetRelationshipOptions(rows);
    assert.deepStrictEqual(result, ["father", "mother"]);
  });

  it("returns values sorted alphabetically (ORDER BY 1)", () => {
    const rows = [
      { relationship: "stepfather", deleted_at: null },
      { relationship: "aunt", deleted_at: null },
      { relationship: "mother", deleted_at: null },
      { relationship: "guardian", deleted_at: null },
    ];
    const result = simulateGetRelationshipOptions(rows);
    assert.deepStrictEqual(result, ["aunt", "guardian", "mother", "stepfather"]);
  });

  it("does not include null-relationship rows in the result", () => {
    const rows = [
      { relationship: "mother", deleted_at: null },
      { relationship: null, deleted_at: null },
      { relationship: "father", deleted_at: null },
    ];
    const result = simulateGetRelationshipOptions(rows);
    assert.ok(!result.includes("null" as string), "null strings must not appear");
    assert.strictEqual(result.length, 2);
  });
});

// ── Pagination (first page) ───────────────────────────────────────────────────

describe("GET /api/organizations/[organizationId]/parents — first-page pagination", () => {
  it("returns first page with correct slice and total count", () => {
    const parents = Array.from({ length: 5 }, (_, i) =>
      makeParent({ last_name: `Person${i}` })
    );
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, limit: 2, offset: 0 });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.total, 5, "total should reflect all matching rows");
    assert.strictEqual(result.parents!.length, 2, "page should contain limit rows");
  });

  it("total reflects full count regardless of page size", () => {
    const parents = Array.from({ length: 10 }, () => makeParent());
    // Fetch page 1 (limit=3, offset=0)
    const page1 = simulateGetParents({ userId: "u1", role: "admin", parents, limit: 3, offset: 0 });
    assert.strictEqual(page1.total, 10);
    assert.strictEqual(page1.parents!.length, 3);

    // Fetch page 4 (limit=3, offset=9) — last page has only 1 row
    const page4 = simulateGetParents({ userId: "u1", role: "admin", parents, limit: 3, offset: 9 });
    assert.strictEqual(page4.total, 10);
    assert.strictEqual(page4.parents!.length, 1);
  });

  it("returns empty array for offset beyond total count", () => {
    const parents = Array.from({ length: 3 }, () => makeParent());
    const result = simulateGetParents({ userId: "u1", role: "admin", parents, limit: 50, offset: 100 });
    assert.strictEqual(result.total, 3);
    assert.deepStrictEqual(result.parents, []);
  });
});
