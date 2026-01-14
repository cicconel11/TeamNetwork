import test from "node:test";
import assert from "node:assert/strict";
import {
  canMutateAlumni,
  type AlumniMutationAction,
} from "../../../src/lib/alumni/mutations.ts";

type Role = "admin" | "active_member" | "alumni" | "parent" | null;

function simulateAlumniWritePolicy(params: {
  mutation: AlumniMutationAction;
  role: Role;
  isSelf?: boolean;
  isReadOnly: boolean;
}) {
  const { mutation, role, isSelf = false, isReadOnly } = params;

  if (!role) {
    return { status: 401, error: "Unauthorized" };
  }

  return canMutateAlumni({
    action: mutation,
    isAdmin: role === "admin",
    isSelf,
    isReadOnly,
  });
}

test("alumni create stays allowed for admins during grace period", () => {
  const result = simulateAlumniWritePolicy({
    mutation: "create",
    role: "admin",
    isReadOnly: true,
  });

  assert.deepStrictEqual(result, { allowed: true });
});

test("alumni create still requires admin role during grace period", () => {
  const result = simulateAlumniWritePolicy({
    mutation: "create",
    role: "alumni",
    isReadOnly: true,
  });

  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, 403);
});

test("alumni update is blocked during grace period even for self-edit", () => {
  const result = simulateAlumniWritePolicy({
    mutation: "update",
    role: "alumni",
    isSelf: true,
    isReadOnly: true,
  });

  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Organization is in read-only mode. Please resubscribe to make changes.");
  assert.strictEqual(result.code, "ORG_READ_ONLY");
});

test("alumni delete is blocked during grace period", () => {
  const result = simulateAlumniWritePolicy({
    mutation: "delete",
    role: "admin",
    isReadOnly: true,
  });

  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Organization is in read-only mode. Please resubscribe to make changes.");
  assert.strictEqual(result.code, "ORG_READ_ONLY");
});

test("alumni update still allows self-edit outside grace period", () => {
  const result = simulateAlumniWritePolicy({
    mutation: "update",
    role: "alumni",
    isSelf: true,
    isReadOnly: false,
  });

  assert.deepStrictEqual(result, { allowed: true });
});
