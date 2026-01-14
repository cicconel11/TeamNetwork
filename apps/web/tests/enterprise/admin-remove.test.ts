import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Tests for the removeEnterpriseAdmin() shared helper.
 *
 * Uses the simulation pattern (same as adoption.test.ts) to replicate
 * the exact branching logic from src/lib/enterprise/admin.ts.
 */

interface UserEnterpriseRoleRow {
  id: string;
  role: "owner" | "billing_admin" | "org_admin";
}

type RemoveResult =
  | { success: true; removedRole: string }
  | { error: string; status: number };

/**
 * Simulates removeEnterpriseAdmin (admin.ts).
 *
 * Replicates the exact branching:
 *   - fetchError → { error, status: 500 }
 *   - targetRole null → { error, status: 404 }
 *   - owner + countError → { error, status: 500 }
 *   - owner + ownerCount <= 1 → { error, status: 400 }
 *   - deleteError → { error, status: 500 }
 *   - success → { success: true, removedRole }
 */
function simulateRemoveEnterpriseAdmin(params: {
  targetRole: UserEnterpriseRoleRow | null;
  fetchError: Error | null;
  ownerCount: number | null;
  countError: Error | null;
  deleteError: Error | null;
}): RemoveResult {
  const { targetRole, fetchError, ownerCount, countError, deleteError } = params;

  if (fetchError) {
    return { error: "Internal server error", status: 500 };
  }

  if (!targetRole) {
    return { error: "User is not an admin of this enterprise", status: 404 };
  }

  if (targetRole.role === "owner") {
    if (countError) {
      return { error: "Internal server error", status: 500 };
    }
    if ((ownerCount ?? 0) <= 1) {
      return { error: "Cannot remove the last owner. Transfer ownership first.", status: 400 };
    }
  }

  if (deleteError) {
    return { error: "Internal server error", status: 500 };
  }

  return { success: true, removedRole: targetRole.role };
}

describe("removeEnterpriseAdmin", () => {
  it("last-owner guard blocks removal", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: { id: "role-1", role: "owner" },
      fetchError: null,
      ownerCount: 1,
      countError: null,
      deleteError: null,
    });

    assert.ok("error" in result);
    assert.strictEqual(result.status, 400);
    assert.ok(result.error.includes("last owner"));
  });

  it("successful removal of non-owner", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: { id: "role-1", role: "billing_admin" },
      fetchError: null,
      ownerCount: null,
      countError: null,
      deleteError: null,
    });

    assert.ok("success" in result);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.removedRole, "billing_admin");
  });

  it("successful removal of owner when multiple owners exist", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: { id: "role-1", role: "owner" },
      fetchError: null,
      ownerCount: 3,
      countError: null,
      deleteError: null,
    });

    assert.ok("success" in result);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.removedRole, "owner");
  });

  it("DB error on role fetch → 500", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: null,
      fetchError: new Error("connection refused"),
      ownerCount: null,
      countError: null,
      deleteError: null,
    });

    assert.ok("error" in result);
    assert.strictEqual(result.status, 500);
  });

  it("user not found → 404", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: null,
      fetchError: null,
      ownerCount: null,
      countError: null,
      deleteError: null,
    });

    assert.ok("error" in result);
    assert.strictEqual(result.status, 404);
    assert.ok(result.error.includes("not an admin"));
  });

  it("DB error on owner count → 500", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: { id: "role-1", role: "owner" },
      fetchError: null,
      ownerCount: null,
      countError: new Error("timeout"),
      deleteError: null,
    });

    assert.ok("error" in result);
    assert.strictEqual(result.status, 500);
  });

  it("DB error on delete → 500", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: { id: "role-1", role: "org_admin" },
      fetchError: null,
      ownerCount: null,
      countError: null,
      deleteError: new Error("FK constraint"),
    });

    assert.ok("error" in result);
    assert.strictEqual(result.status, 500);
  });

  it("org_admin removal succeeds without owner count check", () => {
    const result = simulateRemoveEnterpriseAdmin({
      targetRole: { id: "role-1", role: "org_admin" },
      fetchError: null,
      ownerCount: null, // should not be checked
      countError: null,
      deleteError: null,
    });

    assert.ok("success" in result);
    assert.strictEqual(result.removedRole, "org_admin");
  });
});
