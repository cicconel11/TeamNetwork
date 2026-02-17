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
