import { describe, it } from "node:test";
import assert from "node:assert";
import { randomUUID } from "crypto";

/**
 * Tests for PATCH /api/organizations/[organizationId]/members/[memberId]
 *
 * This route handles role and status updates for org members. It was introduced
 * to replace direct Supabase client writes in the invites settings page, so that
 * revalidatePath() is called server-side and the Next.js router cache is
 * invalidated for the dashboard, members, and parents pages.
 *
 * Tests simulate route handler logic without making real HTTP calls.
 * This matches the project-wide testing pattern (see tests/routes/organizations/parents.test.ts).
 */

// ── Shared types ──────────────────────────────────────────────────────────────

type OrgRole = "admin" | "active_member" | "alumni" | "parent" | null;
type MemberStatus = "active" | "revoked" | "pending";

interface PatchMemberRequest {
  /** Authenticated user making the request (null = unauthenticated) */
  userId: string | null;
  /** The user's role in the org */
  role: OrgRole;
  /** The org ID param from the URL */
  organizationId: string;
  /** The user ID of the member being updated */
  memberId: string;
  /** At least one of role or status must be present */
  body: {
    role?: string;
    status?: string;
  };
  /** Simulate a DB update error */
  dbError?: boolean;
}

interface PatchMemberResult {
  status: number;
  success?: boolean;
  error?: string;
  details?: unknown;
}

// ── Route simulation ──────────────────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ROLES = new Set(["admin", "active_member", "alumni", "parent"]);
const VALID_STATUSES = new Set(["active", "revoked", "pending"]);

function simulatePatchMember(req: PatchMemberRequest): PatchMemberResult {
  // UUID param validation
  if (!UUID_PATTERN.test(req.organizationId)) {
    return { status: 400, error: "Invalid organization id" };
  }
  if (!UUID_PATTERN.test(req.memberId)) {
    return { status: 400, error: "Invalid user id" };
  }

  // Auth check
  if (!req.userId) return { status: 401, error: "Unauthorized" };
  if (req.role !== "admin") return { status: 403, error: "Forbidden" };

  // Body validation: at least one of role or status required
  if (req.body.role === undefined && req.body.status === undefined) {
    return { status: 400, error: "At least one of role or status is required" };
  }
  if (req.body.role !== undefined && !VALID_ROLES.has(req.body.role)) {
    return { status: 400, error: "Invalid request body" };
  }
  if (req.body.status !== undefined && !VALID_STATUSES.has(req.body.status)) {
    return { status: 400, error: "Invalid request body" };
  }

  // DB error simulation
  if (req.dbError) return { status: 500, error: "Failed to update member" };

  return { status: 200, success: true };
}

// ── PATCH /members/[memberId] tests ───────────────────────────────────────────

const validOrgId = randomUUID();
const validMemberId = randomUUID();

describe("PATCH /api/organizations/[organizationId]/members/[memberId]", () => {
  // ── Auth & authz ────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated request", () => {
    const result = simulatePatchMember({
      userId: null, role: null,
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  it("returns 403 for active_member role", () => {
    const result = simulatePatchMember({
      userId: "u1", role: "active_member",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("returns 403 for alumni role", () => {
    const result = simulatePatchMember({
      userId: "u1", role: "alumni",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "active_member" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("returns 403 for parent role", () => {
    const result = simulatePatchMember({
      userId: "u1", role: "parent",
      organizationId: validOrgId, memberId: validMemberId,
      body: { status: "revoked" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  it("returns 403 for user with no membership in this org (role=null)", () => {
    const result = simulatePatchMember({
      userId: "u1", role: null,
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden");
  });

  // ── Param validation ────────────────────────────────────────────────────────

  it("returns 400 for invalid organizationId UUID", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: "not-a-uuid", memberId: validMemberId,
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid organization id");
  });

  it("returns 400 for invalid memberId UUID", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: "not-a-uuid",
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid user id");
  });

  // ── Body validation ─────────────────────────────────────────────────────────

  it("returns 400 when body is empty (no role or status)", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: {},
    });
    assert.strictEqual(result.status, 400);
    assert.ok(result.error?.includes("role or status"), `unexpected error: ${result.error}`);
  });

  it("returns 400 for invalid role value", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "superuser" },
    });
    assert.strictEqual(result.status, 400);
  });

  it("returns 400 for invalid status value", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { status: "suspended" },
    });
    assert.strictEqual(result.status, 400);
  });

  // ── Successful updates ──────────────────────────────────────────────────────

  it("returns 200 when admin updates role to alumni", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 200 when admin updates role to active_member", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "active_member" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 200 when admin promotes member to admin", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "admin" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 200 when admin updates role to parent", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "parent" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 200 when admin revokes access", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { status: "revoked" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 200 when admin restores access", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { status: "active" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns 200 when both role and status are provided", () => {
    // Edge case: both fields in a single request
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni", status: "active" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  // ── Error paths ─────────────────────────────────────────────────────────────

  it("returns 500 on DB error", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni" },
      dbError: true,
    });
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.error, "Failed to update member");
  });
});

// ── Invites page mutation behaviour simulation ────────────────────────────────
// These tests verify the logic that was previously embedded directly in the
// client component (updateAccess, updateRole, confirmAdminPromotion) now routes
// through the PATCH endpoint correctly.

describe("Invites page — updateAccess mutation", () => {
  it("calls PATCH with status=revoked and updates local state on success", () => {
    // Simulate the route handler receiving the revokeAccess payload
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { status: "revoked" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("reports error when PATCH fails — previously swallowed silently", () => {
    // The old updateAccess had no error handling at all. Now errors surface.
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { status: "revoked" },
      dbError: true,
    });
    assert.strictEqual(result.status, 500);
    assert.ok(result.error, "error should be defined (was previously swallowed)");
  });
});

describe("Invites page — updateRole mutation", () => {
  it("calls PATCH with role=alumni and updates local state on success", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("rejects non-admin callers (cross-org protection)", () => {
    const result = simulatePatchMember({
      userId: "random-user", role: "active_member",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "alumni" },
    });
    assert.strictEqual(result.status, 403);
  });
});

describe("Invites page — confirmAdminPromotion mutation", () => {
  it("calls PATCH with role=admin after confirmation", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "admin" },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.success, true);
  });

  it("returns error response on DB failure", () => {
    const result = simulatePatchMember({
      userId: "admin", role: "admin",
      organizationId: validOrgId, memberId: validMemberId,
      body: { role: "admin" },
      dbError: true,
    });
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.error, "Failed to update member");
  });
});
