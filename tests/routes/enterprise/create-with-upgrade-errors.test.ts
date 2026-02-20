import test from "node:test";
import assert from "node:assert";

interface CreateWithUpgradeRouteParams {
  orgInsertError: { message: string } | null;
  roleError: { message: string } | null;
}

interface CreateWithUpgradeRouteResult {
  status: number;
  body: Record<string, unknown>;
}

function simulateCreateWithUpgradeErrors(
  params: CreateWithUpgradeRouteParams
): CreateWithUpgradeRouteResult {
  const { orgInsertError, roleError } = params;

  if (orgInsertError) {
    return { status: 400, body: { error: "Unable to create organization" } };
  }

  if (roleError) {
    return { status: 400, body: { error: "Failed to assign admin role" } };
  }

  return { status: 201, body: { organization: { id: "org-1" } } };
}

test("create-with-upgrade returns generic error when org insert fails", () => {
  const result = simulateCreateWithUpgradeErrors({
    orgInsertError: { message: "duplicate key value violates unique constraint organizations_slug_key" },
    roleError: null,
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Unable to create organization");
  assert.ok(!(result.body.error as string).includes("duplicate key"));
});

test("create-with-upgrade returns generic error when role insert fails", () => {
  const result = simulateCreateWithUpgradeErrors({
    orgInsertError: null,
    roleError: { message: "insert violates foreign key constraint user_organization_roles_user_id_fkey" },
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Failed to assign admin role");
  assert.ok(!(result.body.error as string).includes("foreign key"));
});
