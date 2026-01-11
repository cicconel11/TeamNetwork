import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { canEditOrgName } from "../src/lib/validation/role-editability";
import type { OrgRole } from "../src/lib/auth/role-utils";

/**
 * Property 1: Role-based Organization Name Editability
 * Validates: Requirements 1.1, 1.2
 *
 * For any user viewing the settings page, the organization name field
 * should be editable if and only if the user has the "admin" role.
 */
test("Property 1: Role-based Organization Name Editability", async (t) => {
    const allRoles: (OrgRole | null)[] = ["admin", "active_member", "alumni", null];

    await t.test("admin role can edit organization name", () => {
        const result = canEditOrgName("admin");
        assert.strictEqual(result, true, "Admin should be able to edit org name");
    });

    await t.test("non-admin roles cannot edit organization name", () => {
        fc.assert(
            fc.property(
                fc.constantFrom<OrgRole | null>("active_member", "alumni", null),
                (role) => {
                    const result = canEditOrgName(role);
                    assert.strictEqual(result, false, `Role "${role}" should not be able to edit org name`);
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("editability is true iff role is admin", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...allRoles),
                (role) => {
                    const canEdit = canEditOrgName(role);
                    const isAdmin = role === "admin";
                    assert.strictEqual(canEdit, isAdmin, `canEdit should equal isAdmin for role "${role}"`);
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("null role cannot edit", () => {
        const result = canEditOrgName(null);
        assert.strictEqual(result, false, "Null role should not be able to edit");
    });
});
