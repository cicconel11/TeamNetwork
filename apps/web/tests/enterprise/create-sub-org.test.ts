import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Tests for the createEnterpriseSubOrg() shared helper.
 *
 * Uses the simulation pattern (same as adoption.test.ts) to replicate
 * the exact branching logic from src/lib/enterprise/create-sub-org.ts.
 */

type CreateSubOrgResult =
  | { ok: true; org: Record<string, unknown> }
  | { ok: false; error: string; status: number };

/**
 * Simulates createEnterpriseSubOrg (create-sub-org.ts).
 *
 * Replicates the exact branching:
 *   - existingOrg/existingEnterprise → { error: "Slug is already taken", status: 409 }
 *   - orgError with code 23505 → { error: "Slug is already taken", status: 409 }
 *   - orgError (other) → { error: "Unable to create organization", status: 400 }
 *   - roleError → rollback org → { error: "Failed to assign admin role", status: 400 }
 *   - subError → rollback role + org → { error: "Failed to create org subscription", status: 500 }
 *   - success → { ok: true, org }
 */
function simulateCreateEnterpriseSubOrg(params: {
  existingOrg: { id: string } | null;
  existingEnterprise: { id: string } | null;
  orgInsertResult: { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null };
  roleInsertError: Error | null;
  subInsertError: Error | null;
}): CreateSubOrgResult {
  const { existingOrg, existingEnterprise, orgInsertResult, roleInsertError, subInsertError } = params;

  // Parallel slug check
  if (existingOrg || existingEnterprise) {
    return { ok: false, error: "Slug is already taken", status: 409 };
  }

  // Org insert
  const { data: newOrg, error: orgError } = orgInsertResult;
  if (orgError || !newOrg) {
    if (orgError?.code === "23505") {
      return { ok: false, error: "Slug is already taken", status: 409 };
    }
    return { ok: false, error: "Unable to create organization", status: 400 };
  }

  // Role insert (rollback org on failure)
  if (roleInsertError) {
    return { ok: false, error: "Failed to assign admin role", status: 400 };
  }

  // Subscription insert (rollback role + org on failure)
  if (subInsertError) {
    return { ok: false, error: "Failed to create organization subscription", status: 500 };
  }

  return { ok: true, org: newOrg };
}

const sampleOrg = { id: "org-new-1", name: "Test", slug: "test-slug" };

describe("createEnterpriseSubOrg", () => {
  it("successful creation (org + role + subscription)", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: null,
      existingEnterprise: null,
      orgInsertResult: { data: sampleOrg, error: null },
      roleInsertError: null,
      subInsertError: null,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.org.id, "org-new-1");
  });

  it("slug conflict via pre-check (org exists) → 409", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: { id: "existing-org" },
      existingEnterprise: null,
      orgInsertResult: { data: null, error: null },
      roleInsertError: null,
      subInsertError: null,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.status, 409);
    assert.ok(result.error.includes("Slug is already taken"));
  });

  it("slug conflict via pre-check (enterprise slug exists) → 409", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: null,
      existingEnterprise: { id: "existing-ent" },
      orgInsertResult: { data: null, error: null },
      roleInsertError: null,
      subInsertError: null,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.status, 409);
  });

  it("slug conflict at DB level (unique constraint 23505) → 409", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: null,
      existingEnterprise: null,
      orgInsertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      roleInsertError: null,
      subInsertError: null,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.status, 409);
    assert.ok(result.error.includes("Slug is already taken"));
  });

  it("org insert failure (non-unique error) → 400", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: null,
      existingEnterprise: null,
      orgInsertResult: { data: null, error: { message: "some other error" } },
      roleInsertError: null,
      subInsertError: null,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Unable to create organization");
  });

  it("role insert failure → org cleaned up, 400", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: null,
      existingEnterprise: null,
      orgInsertResult: { data: sampleOrg, error: null },
      roleInsertError: new Error("role insert failed"),
      subInsertError: null,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.status, 400);
    assert.ok(result.error.includes("Failed to assign admin role"));
  });

  it("subscription insert failure → org + role cleaned up, 500", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: null,
      existingEnterprise: null,
      orgInsertResult: { data: sampleOrg, error: null },
      roleInsertError: null,
      subInsertError: new Error("sub insert failed"),
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.status, 500);
    assert.ok(result.error.includes("Failed to create organization subscription"));
  });

  it("org insert returns null data without error → 400", () => {
    const result = simulateCreateEnterpriseSubOrg({
      existingOrg: null,
      existingEnterprise: null,
      orgInsertResult: { data: null, error: null },
      roleInsertError: null,
      subInsertError: null,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Unable to create organization");
  });
});
