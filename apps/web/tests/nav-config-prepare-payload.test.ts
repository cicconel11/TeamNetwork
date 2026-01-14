import test from "node:test";
import assert from "node:assert";

/**
 * Tests for preparePayload role-filtering logic — replicated inline from:
 *   src/app/[orgSlug]/settings/navigation/page.tsx
 *
 * The critical fix: ALLOWED_ROLES in the page was previously ["admin", "active_member", "alumni"].
 * "parent" was added to fix a silent stripping bug where hiddenForRoles/editRoles containing
 * "parent" would be filtered out before being sent to the backend.
 *
 * These tests verify:
 *   1. The old behavior (regression proof): parent is silently stripped
 *   2. The new behavior (after fix): parent is preserved
 */

// ----- Replicated role lists -----

type OrgRole = "admin" | "active_member" | "alumni" | "parent";

/** Before the fix — parent was NOT in the allowed list */
const OLD_ALLOWED_ROLES: OrgRole[] = ["admin", "active_member", "alumni"];

/** After the fix — parent is now included */
const NEW_ALLOWED_ROLES: OrgRole[] = ["admin", "active_member", "alumni", "parent"];

// ----- Replicated helpers (mirrors preparePayload internals) -----

/**
 * Filters and deduplicates roles for hiddenForRoles.
 * Returns undefined when no valid roles remain (key is then omitted from payload).
 */
function filterHiddenRoles(
  roles: string[],
  allowedRoles: OrgRole[]
): OrgRole[] | undefined {
  const filtered = roles.filter((role): role is OrgRole =>
    allowedRoles.includes(role as OrgRole)
  );
  if (!filtered.length) return undefined;
  return Array.from(new Set(filtered));
}

/**
 * Filters and deduplicates roles for editRoles, forcing "admin" into the result.
 * Returns undefined when no valid roles remain (key is then omitted from payload).
 */
function filterEditRoles(
  roles: string[],
  allowedRoles: OrgRole[]
): OrgRole[] | undefined {
  const filtered = roles.filter((role): role is OrgRole =>
    allowedRoles.includes(role as OrgRole)
  );
  if (!filtered.length) return undefined;
  return Array.from(new Set([...filtered, "admin"] as OrgRole[]));
}

// ----- Regression tests (old behavior) -----

test("preparePayload regression: OLD_ALLOWED_ROLES silently strips parent from hiddenForRoles", () => {
  const result = filterHiddenRoles(["parent"], OLD_ALLOWED_ROLES);
  assert.strictEqual(
    result,
    undefined,
    "parent should be stripped and key omitted (demonstrates the pre-fix bug)"
  );
});

test("preparePayload regression: OLD_ALLOWED_ROLES silently strips parent from editRoles", () => {
  const result = filterEditRoles(["parent"], OLD_ALLOWED_ROLES);
  assert.strictEqual(
    result,
    undefined,
    "parent-only editRoles should be stripped entirely with old ALLOWED_ROLES"
  );
});

// ----- Fix tests (new behavior) -----

test("preparePayload fix: NEW_ALLOWED_ROLES preserves parent in hiddenForRoles", () => {
  const result = filterHiddenRoles(["parent"], NEW_ALLOWED_ROLES);
  assert.deepStrictEqual(result, ["parent"], "parent should be preserved after fix");
});

test("preparePayload fix: NEW_ALLOWED_ROLES preserves parent in editRoles (admin forced)", () => {
  const result = filterEditRoles(["parent"], NEW_ALLOWED_ROLES);
  assert.ok(result?.includes("parent"), "parent should be in editRoles after fix");
  assert.ok(result?.includes("admin"), "admin should be forced into editRoles");
  assert.strictEqual(result?.length, 2, "should have exactly [parent, admin]");
});

test("preparePayload fix: hiddenForRoles with alumni and parent both preserved", () => {
  const result = filterHiddenRoles(["alumni", "parent"], NEW_ALLOWED_ROLES);
  assert.ok(result?.includes("alumni"), "alumni should be preserved");
  assert.ok(result?.includes("parent"), "parent should be preserved");
  assert.strictEqual(result?.length, 2, "should have exactly 2 roles");
});

test("preparePayload fix: editRoles with alumni and parent both preserved, admin forced once", () => {
  const result = filterEditRoles(["alumni", "parent"], NEW_ALLOWED_ROLES);
  assert.ok(result?.includes("alumni"), "alumni should be preserved");
  assert.ok(result?.includes("parent"), "parent should be preserved");
  assert.ok(result?.includes("admin"), "admin should be forced");
  const adminCount = (result ?? []).filter((r) => r === "admin").length;
  assert.strictEqual(adminCount, 1, "admin should appear exactly once");
});

// ----- Non-parent behavior unchanged -----

test("preparePayload: non-parent roles still work correctly with new ALLOWED_ROLES", () => {
  const result = filterHiddenRoles(["active_member", "alumni"], NEW_ALLOWED_ROLES);
  assert.ok(result?.includes("active_member"), "active_member should be preserved");
  assert.ok(result?.includes("alumni"), "alumni should be preserved");
  assert.strictEqual(result?.length, 2, "should have exactly 2 roles");
});

test("preparePayload: editRoles with active_member still works after fix", () => {
  const result = filterEditRoles(["active_member"], NEW_ALLOWED_ROLES);
  assert.ok(result?.includes("active_member"), "active_member should be preserved");
  assert.ok(result?.includes("admin"), "admin should be forced");
  assert.strictEqual(result?.length, 2);
});

test("preparePayload: invalid role is stripped regardless of ALLOWED_ROLES version", () => {
  const resultOld = filterHiddenRoles(["superadmin"], OLD_ALLOWED_ROLES);
  const resultNew = filterHiddenRoles(["superadmin"], NEW_ALLOWED_ROLES);
  assert.strictEqual(resultOld, undefined, "superadmin stripped with old ALLOWED_ROLES");
  assert.strictEqual(resultNew, undefined, "superadmin stripped with new ALLOWED_ROLES");
});
