import test from "node:test";
import assert from "node:assert";
import { resolveEnterpriseOwnershipCheck } from "../../src/lib/auth/enterprise-ownership-check.ts";

test("resolveEnterpriseOwnershipCheck fails closed on owner query error", () => {
  const result = resolveEnterpriseOwnershipCheck({
    enterpriseRoles: [{ enterprise_id: "ent_1", role: "owner" }],
    error: { code: "XX001", message: "query failed" },
  });

  assert.strictEqual(result.error, "Failed to verify enterprise ownership");
  assert.strictEqual(result.isOwner, false);
});

test("resolveEnterpriseOwnershipCheck marks owner when owner roles exist", () => {
  const result = resolveEnterpriseOwnershipCheck({
    enterpriseRoles: [{ enterprise_id: "ent_1", role: "owner" }],
    error: null,
  });

  assert.strictEqual(result.error, null);
  assert.strictEqual(result.isOwner, true);
});

test("resolveEnterpriseOwnershipCheck allows deletion when no owner roles exist", () => {
  const result = resolveEnterpriseOwnershipCheck({
    enterpriseRoles: [],
    error: null,
  });

  assert.strictEqual(result.error, null);
  assert.strictEqual(result.isOwner, false);
});

test("resolveEnterpriseOwnershipCheck reports no owner when empty roles returned", () => {
  // The delete-account route filters by .eq("role", "owner") before calling this.
  // So billing_admin/org_admin users will have their query return [] and this
  // function will correctly report isOwner: false.
  const result = resolveEnterpriseOwnershipCheck({
    enterpriseRoles: [],
    error: null,
  });

  assert.strictEqual(result.error, null);
  assert.strictEqual(result.isOwner, false);
});

test("billing_admin and org_admin cannot block deletion — route pre-filters to owner only", () => {
  // The delete-account route queries .eq("role", "owner"), meaning billing_admin
  // and org_admin users will never have their role rows appear in the ownership check.
  // This test verifies the function returns isOwner: false when passed an empty
  // array (as the route would pass for non-owners).
  const emptyResult = resolveEnterpriseOwnershipCheck({
    enterpriseRoles: [], // Route would return [] for billing_admin/org_admin users
    error: null,
  });

  assert.strictEqual(emptyResult.isOwner, false);
  assert.strictEqual(emptyResult.error, null);
});
