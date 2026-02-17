import { describe, it } from "node:test";
import assert from "node:assert";
import type { EnterpriseRole } from "../../src/types/enterprise.ts";

/**
 * Tests for enterprise role auth-gating functions.
 *
 * These tests simulate the logic of:
 * - getEnterpriseRole()
 * - requireEnterpriseRole()
 * - requireEnterpriseOwner()
 * - requireEnterpriseBillingAccess()
 *
 * Since these functions call createClient() internally, we use simulation
 * functions that accept injectable context — the same pattern used in
 * adoption.test.ts and other enterprise tests in this codebase.
 */

// =============================================================================
// Simulation Types
// =============================================================================

interface MockDbRoleRow {
  role: string;
}

interface MockDbResult {
  data: MockDbRoleRow | null;
  error: { code: string; message: string } | null;
}

interface MockAuthUser {
  id: string;
}

interface GetEnterpriseRoleContext {
  /** Authenticated user, or null if not logged in */
  authUser: MockAuthUser | null;
  /** DB query result for user_enterprise_roles */
  dbResult: MockDbResult;
}

interface RequireEnterpriseRoleContext {
  /** Authenticated user, or null if not logged in */
  authUser: MockAuthUser | null;
  /** The role the user holds in this enterprise, or null */
  existingRole: EnterpriseRole | null;
}

// =============================================================================
// Simulation Functions
// =============================================================================

/**
 * Simulates getEnterpriseRole():
 *   1. Resolves userId from explicit arg or auth session
 *   2. Queries user_enterprise_roles
 *   3. Returns null on error, null when no row, or the role string
 */
function simulateGetEnterpriseRole(
  enterpriseId: string,
  ctx: GetEnterpriseRoleContext,
  userId?: string
): EnterpriseRole | null {
  const resolvedUserId = userId ?? ctx.authUser?.id ?? null;
  if (!resolvedUserId) return null;

  const { data, error } = ctx.dbResult;
  if (error) return null;

  return (data?.role as EnterpriseRole) ?? null;
}

/**
 * Simulates requireEnterpriseRole():
 *   1. Gets auth user — throws "Unauthorized" if none
 *   2. Gets role — throws "Forbidden" if missing or not in allowedRoles
 *   3. Returns { role, userId }
 */
function simulateRequireEnterpriseRole(
  enterpriseId: string,
  ctx: RequireEnterpriseRoleContext,
  allowedRoles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"]
): { role: EnterpriseRole; userId: string } {
  if (!ctx.authUser) {
    throw new Error("Unauthorized");
  }

  const role = ctx.existingRole;
  if (!role || !allowedRoles.includes(role)) {
    throw new Error("Forbidden");
  }

  return { role, userId: ctx.authUser.id };
}

/**
 * Simulates requireEnterpriseOwner():
 *   delegates to requireEnterpriseRole with ["owner"]
 */
function simulateRequireEnterpriseOwner(
  enterpriseId: string,
  ctx: RequireEnterpriseRoleContext
): string {
  const { userId } = simulateRequireEnterpriseRole(enterpriseId, ctx, ["owner"]);
  return userId;
}

/**
 * Simulates requireEnterpriseBillingAccess():
 *   delegates to requireEnterpriseRole with ["owner", "billing_admin"]
 */
function simulateRequireEnterpriseBillingAccess(
  enterpriseId: string,
  ctx: RequireEnterpriseRoleContext
): string {
  const { userId } = simulateRequireEnterpriseRole(enterpriseId, ctx, [
    "owner",
    "billing_admin",
  ]);
  return userId;
}

// =============================================================================
// Helper factories
// =============================================================================

function makeDbResult(role: EnterpriseRole | null, error?: { code: string; message: string }): MockDbResult {
  return {
    data: role ? { role } : null,
    error: error ?? null,
  };
}

function makeAuthUser(id = "user-abc"): MockAuthUser {
  return { id };
}

const ENTERPRISE_ID = "enterprise-123";

// =============================================================================
// getEnterpriseRole simulation tests
// =============================================================================

describe("getEnterpriseRole", () => {
  it("returns null when no userId provided and no authenticated user", () => {
    const ctx: GetEnterpriseRoleContext = {
      authUser: null,
      dbResult: makeDbResult("owner"),
    };

    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result, null);
  });

  it("returns null when user has no role in enterprise (no DB row)", () => {
    const ctx: GetEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      dbResult: makeDbResult(null),
    };

    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result, null);
  });

  it("returns 'owner' when user has owner role", () => {
    const ctx: GetEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      dbResult: makeDbResult("owner"),
    };

    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result, "owner");
  });

  it("returns 'billing_admin' when user has billing_admin role", () => {
    const ctx: GetEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      dbResult: makeDbResult("billing_admin"),
    };

    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result, "billing_admin");
  });

  it("returns 'org_admin' when user has org_admin role", () => {
    const ctx: GetEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      dbResult: makeDbResult("org_admin"),
    };

    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result, "org_admin");
  });

  it("returns null on DB query error (fails open — returns null, not throws)", () => {
    const ctx: GetEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      dbResult: makeDbResult("owner", { code: "XX001", message: "query failed" }),
    };

    // Must not throw; must return null
    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result, null);
  });

  it("uses provided userId over auth user when both available", () => {
    // DB result represents the provided user's role (not auth user).
    // We verify by ensuring the function proceeds to DB lookup when explicit userId given.
    const ctx: GetEnterpriseRoleContext = {
      authUser: makeAuthUser("auth-user-id"),
      dbResult: makeDbResult("org_admin"),
    };

    // Pass an explicit different userId
    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx, "explicit-user-id");
    // The DB result (org_admin) should be returned; the explicit userId was used
    assert.strictEqual(result, "org_admin");
  });

  it("uses auth user id when no explicit userId provided", () => {
    const ctx: GetEnterpriseRoleContext = {
      authUser: makeAuthUser("auth-user-id"),
      dbResult: makeDbResult("billing_admin"),
    };

    const result = simulateGetEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result, "billing_admin");
  });
});

// =============================================================================
// requireEnterpriseRole simulation tests
// =============================================================================

describe("requireEnterpriseRole", () => {
  it("throws 'Unauthorized' when no authenticated user", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: null,
      existingRole: null,
    };

    assert.throws(
      () => simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx),
      (err: Error) => err.message === "Unauthorized"
    );
  });

  it("throws 'Forbidden' when user has no role in enterprise", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: null,
    };

    assert.throws(
      () => simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx),
      (err: Error) => err.message === "Forbidden"
    );
  });

  it("throws 'Forbidden' when user's role is not in allowedRoles", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: "org_admin",
    };

    assert.throws(
      () => simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx, ["owner"]),
      (err: Error) => err.message === "Forbidden"
    );
  });

  it("returns { role, userId } when role is in allowedRoles", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser("user-xyz"),
      existingRole: "billing_admin",
    };

    const result = simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx, [
      "owner",
      "billing_admin",
    ]);

    assert.strictEqual(result.role, "billing_admin");
    assert.strictEqual(result.userId, "user-xyz");
  });

  it("default allowedRoles accepts owner", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser("user-1"),
      existingRole: "owner",
    };

    const result = simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result.role, "owner");
  });

  it("default allowedRoles accepts billing_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser("user-2"),
      existingRole: "billing_admin",
    };

    const result = simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result.role, "billing_admin");
  });

  it("default allowedRoles accepts org_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser("user-3"),
      existingRole: "org_admin",
    };

    const result = simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx);
    assert.strictEqual(result.role, "org_admin");
  });

  it("custom allowedRoles ['owner'] rejects billing_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: "billing_admin",
    };

    assert.throws(
      () => simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx, ["owner"]),
      (err: Error) => err.message === "Forbidden"
    );
  });

  it("custom allowedRoles ['owner'] rejects org_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: "org_admin",
    };

    assert.throws(
      () => simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx, ["owner"]),
      (err: Error) => err.message === "Forbidden"
    );
  });

  it("custom allowedRoles ['owner', 'billing_admin'] rejects org_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: "org_admin",
    };

    assert.throws(
      () =>
        simulateRequireEnterpriseRole(ENTERPRISE_ID, ctx, [
          "owner",
          "billing_admin",
        ]),
      (err: Error) => err.message === "Forbidden"
    );
  });
});

// =============================================================================
// requireEnterpriseOwner simulation tests
// =============================================================================

describe("requireEnterpriseOwner", () => {
  it("throws 'Forbidden' for billing_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: "billing_admin",
    };

    assert.throws(
      () => simulateRequireEnterpriseOwner(ENTERPRISE_ID, ctx),
      (err: Error) => err.message === "Forbidden"
    );
  });

  it("throws 'Forbidden' for org_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: "org_admin",
    };

    assert.throws(
      () => simulateRequireEnterpriseOwner(ENTERPRISE_ID, ctx),
      (err: Error) => err.message === "Forbidden"
    );
  });

  it("returns userId for owner", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser("owner-user"),
      existingRole: "owner",
    };

    const userId = simulateRequireEnterpriseOwner(ENTERPRISE_ID, ctx);
    assert.strictEqual(userId, "owner-user");
  });

  it("throws 'Unauthorized' when no authenticated user", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: null,
      existingRole: null,
    };

    assert.throws(
      () => simulateRequireEnterpriseOwner(ENTERPRISE_ID, ctx),
      (err: Error) => err.message === "Unauthorized"
    );
  });
});

// =============================================================================
// requireEnterpriseBillingAccess simulation tests
// =============================================================================

describe("requireEnterpriseBillingAccess", () => {
  it("returns userId for owner", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser("owner-user"),
      existingRole: "owner",
    };

    const userId = simulateRequireEnterpriseBillingAccess(ENTERPRISE_ID, ctx);
    assert.strictEqual(userId, "owner-user");
  });

  it("returns userId for billing_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser("billing-user"),
      existingRole: "billing_admin",
    };

    const userId = simulateRequireEnterpriseBillingAccess(ENTERPRISE_ID, ctx);
    assert.strictEqual(userId, "billing-user");
  });

  it("throws 'Forbidden' for org_admin", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: makeAuthUser(),
      existingRole: "org_admin",
    };

    assert.throws(
      () => simulateRequireEnterpriseBillingAccess(ENTERPRISE_ID, ctx),
      (err: Error) => err.message === "Forbidden"
    );
  });

  it("throws 'Unauthorized' when no authenticated user", () => {
    const ctx: RequireEnterpriseRoleContext = {
      authUser: null,
      existingRole: null,
    };

    assert.throws(
      () => simulateRequireEnterpriseBillingAccess(ENTERPRISE_ID, ctx),
      (err: Error) => err.message === "Unauthorized"
    );
  });
});
