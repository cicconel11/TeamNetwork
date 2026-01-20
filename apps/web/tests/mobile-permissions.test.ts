/**
 * Tests for mobile app permission helpers.
 * These tests validate the permission logic for mobile UX gating.
 *
 * The permission functions are now in @teammeet/core and imported here.
 */

import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import {
  canViewAlumni,
  canUseAdminActions,
  canViewDonations,
  canViewRecords,
  canViewForms,
  type OrgRole,
} from "@teammeet/core";

const ALL_ROLES: (OrgRole | null)[] = ["admin", "active_member", "alumni", null];
const VALID_ROLES: OrgRole[] = ["admin", "active_member", "alumni"];

/**
 * Test: canViewAlumni permission
 */
test("canViewAlumni permission helper", async (t) => {
  await t.test("returns false when alumniEnabled flag is false", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ROLES), (role) => {
        const result = canViewAlumni(role, { alumniEnabled: false });
        assert.strictEqual(result, false, `Should return false for role "${role}" when alumni disabled`);
      }),
      { numRuns: 100 }
    );
  });

  await t.test("returns false when viewerRole is null (even if flag is true)", () => {
    const result = canViewAlumni(null, { alumniEnabled: true });
    assert.strictEqual(result, false, "Should return false for null role");
  });

  await t.test("returns true for any valid role when alumniEnabled is true", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_ROLES), (role) => {
        const result = canViewAlumni(role, { alumniEnabled: true });
        assert.strictEqual(result, true, `Should return true for role "${role}" when alumni enabled`);
      }),
      { numRuns: 100 }
    );
  });

  await t.test("alumni members can view alumni directory when enabled", () => {
    const result = canViewAlumni("alumni", { alumniEnabled: true });
    assert.strictEqual(result, true, "Alumni users should be able to view alumni directory");
  });
});

/**
 * Test: canUseAdminActions permission
 */
test("canUseAdminActions permission helper", async (t) => {
  await t.test("only admin role returns true", () => {
    const result = canUseAdminActions("admin");
    assert.strictEqual(result, true, "Admin should be able to use admin actions");
  });

  await t.test("non-admin roles return false", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<OrgRole | null>("active_member", "alumni", null),
        (role) => {
          const result = canUseAdminActions(role);
          assert.strictEqual(result, false, `Role "${role}" should not use admin actions`);
        }
      ),
      { numRuns: 100 }
    );
  });

  await t.test("null role returns false", () => {
    const result = canUseAdminActions(null);
    assert.strictEqual(result, false, "Null role should not use admin actions");
  });

  await t.test("admin action access is exactly admin role", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ROLES), (role) => {
        const canUse = canUseAdminActions(role);
        const isAdmin = role === "admin";
        assert.strictEqual(canUse, isAdmin, `canUseAdminActions should equal isAdmin for role "${role}"`);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Test: canViewDonations permission
 */
test("canViewDonations permission helper", async (t) => {
  await t.test("returns false when donationsEnabled flag is false", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ROLES), (role) => {
        const result = canViewDonations(role, { donationsEnabled: false });
        assert.strictEqual(result, false, `Should return false for role "${role}" when donations disabled`);
      }),
      { numRuns: 100 }
    );
  });

  await t.test("returns true for any valid role when donationsEnabled is true", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_ROLES), (role) => {
        const result = canViewDonations(role, { donationsEnabled: true });
        assert.strictEqual(result, true, `Should return true for role "${role}" when donations enabled`);
      }),
      { numRuns: 100 }
    );
  });

  await t.test("returns false for null role even when enabled", () => {
    const result = canViewDonations(null, { donationsEnabled: true });
    assert.strictEqual(result, false, "Should return false for null role");
  });
});

/**
 * Test: canViewRecords permission
 */
test("canViewRecords permission helper", async (t) => {
  await t.test("returns false when recordsEnabled flag is false", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_ROLES), (role) => {
        const result = canViewRecords(role, { recordsEnabled: false });
        assert.strictEqual(result, false, `Should return false for role "${role}" when records disabled`);
      }),
      { numRuns: 100 }
    );
  });

  await t.test("returns true for any valid role when recordsEnabled is true", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_ROLES), (role) => {
        const result = canViewRecords(role, { recordsEnabled: true });
        assert.strictEqual(result, true, `Should return true for role "${role}" when records enabled`);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Test: canViewForms permission
 */
test("canViewForms permission helper", async (t) => {
  await t.test("returns false when formsEnabled flag is false", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_ROLES), (role) => {
        const result = canViewForms(role, { formsEnabled: false });
        assert.strictEqual(result, false, `Should return false for role "${role}" when forms disabled`);
      }),
      { numRuns: 100 }
    );
  });

  await t.test("returns true for any valid role when formsEnabled is true", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_ROLES), (role) => {
        const result = canViewForms(role, { formsEnabled: true });
        assert.strictEqual(result, true, `Should return true for role "${role}" when forms enabled`);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Test: Permissions consistency across all feature flags
 */
test("Permissions consistency", async (t) => {
  await t.test("null role never has access to any feature", () => {
    assert.strictEqual(canViewAlumni(null, { alumniEnabled: true }), false);
    assert.strictEqual(canUseAdminActions(null), false);
    assert.strictEqual(canViewDonations(null, { donationsEnabled: true }), false);
    assert.strictEqual(canViewRecords(null, { recordsEnabled: true }), false);
    assert.strictEqual(canViewForms(null, { formsEnabled: true }), false);
  });

  await t.test("admin has access to all enabled features", () => {
    assert.strictEqual(canViewAlumni("admin", { alumniEnabled: true }), true);
    assert.strictEqual(canUseAdminActions("admin"), true);
    assert.strictEqual(canViewDonations("admin", { donationsEnabled: true }), true);
    assert.strictEqual(canViewRecords("admin", { recordsEnabled: true }), true);
    assert.strictEqual(canViewForms("admin", { formsEnabled: true }), true);
  });

  await t.test("active_member cannot use admin actions but can view other features when enabled", () => {
    assert.strictEqual(canViewAlumni("active_member", { alumniEnabled: true }), true);
    assert.strictEqual(canUseAdminActions("active_member"), false);
    assert.strictEqual(canViewDonations("active_member", { donationsEnabled: true }), true);
    assert.strictEqual(canViewRecords("active_member", { recordsEnabled: true }), true);
    assert.strictEqual(canViewForms("active_member", { formsEnabled: true }), true);
  });

  await t.test("alumni cannot use admin actions but can view other features when enabled", () => {
    assert.strictEqual(canViewAlumni("alumni", { alumniEnabled: true }), true);
    assert.strictEqual(canUseAdminActions("alumni"), false);
    assert.strictEqual(canViewDonations("alumni", { donationsEnabled: true }), true);
    assert.strictEqual(canViewRecords("alumni", { recordsEnabled: true }), true);
    assert.strictEqual(canViewForms("alumni", { formsEnabled: true }), true);
  });
});
