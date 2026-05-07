import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getEnterprisePermissions,
  type EnterpriseRole,
  type EnterpriseRolePermissions,
} from "../../src/types/enterprise.ts";

/**
 * Tests for enterprise role utilities
 *
 * These tests verify:
 * 1. getEnterprisePermissions() returns correct permissions for each role
 * 2. All permission fields are present
 * 3. Role hierarchy is correctly implemented
 */

describe("getEnterprisePermissions", () => {
  describe("owner role", () => {
    it("has all permissions enabled", () => {
      const permissions = getEnterprisePermissions("owner");

      assert.strictEqual(permissions.canViewDashboard, true);
      assert.strictEqual(permissions.canCreateSubOrg, true);
      assert.strictEqual(permissions.canAdoptOrg, true);
      assert.strictEqual(permissions.canRemoveSubOrg, true);
      assert.strictEqual(permissions.canManageBilling, true);
      assert.strictEqual(permissions.canInviteAdmins, true);
    });

    it("returns all true values", () => {
      const permissions = getEnterprisePermissions("owner");
      const values = Object.values(permissions);

      assert.strictEqual(values.every((v) => v === true), true);
    });
  });

  describe("billing_admin role", () => {
    it("can view dashboard", () => {
      const permissions = getEnterprisePermissions("billing_admin");
      assert.strictEqual(permissions.canViewDashboard, true);
    });

    it("can manage billing", () => {
      const permissions = getEnterprisePermissions("billing_admin");
      assert.strictEqual(permissions.canManageBilling, true);
    });

    it("cannot create sub-organizations", () => {
      const permissions = getEnterprisePermissions("billing_admin");
      assert.strictEqual(permissions.canCreateSubOrg, false);
    });

    it("cannot adopt organizations", () => {
      const permissions = getEnterprisePermissions("billing_admin");
      assert.strictEqual(permissions.canAdoptOrg, false);
    });

    it("cannot remove sub-organizations", () => {
      const permissions = getEnterprisePermissions("billing_admin");
      assert.strictEqual(permissions.canRemoveSubOrg, false);
    });

    it("cannot invite admins", () => {
      const permissions = getEnterprisePermissions("billing_admin");
      assert.strictEqual(permissions.canInviteAdmins, false);
    });
  });

  describe("org_admin role", () => {
    it("can view dashboard", () => {
      const permissions = getEnterprisePermissions("org_admin");
      assert.strictEqual(permissions.canViewDashboard, true);
    });

    it("can create sub-organizations", () => {
      const permissions = getEnterprisePermissions("org_admin");
      assert.strictEqual(permissions.canCreateSubOrg, true);
    });

    it("cannot adopt organizations", () => {
      const permissions = getEnterprisePermissions("org_admin");
      assert.strictEqual(permissions.canAdoptOrg, false);
    });

    it("cannot remove sub-organizations", () => {
      const permissions = getEnterprisePermissions("org_admin");
      assert.strictEqual(permissions.canRemoveSubOrg, false);
    });

    it("cannot manage billing", () => {
      const permissions = getEnterprisePermissions("org_admin");
      assert.strictEqual(permissions.canManageBilling, false);
    });

    it("cannot invite admins", () => {
      const permissions = getEnterprisePermissions("org_admin");
      assert.strictEqual(permissions.canInviteAdmins, false);
    });
  });
});

describe("permission structure", () => {
  it("all roles return the same permission keys", () => {
    const roles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];
    const expectedKeys = [
      "canViewDashboard",
      "canCreateSubOrg",
      "canAdoptOrg",
      "canRemoveSubOrg",
      "canManageBilling",
      "canInviteAdmins",
    ];

    for (const role of roles) {
      const permissions = getEnterprisePermissions(role);
      const keys = Object.keys(permissions);

      assert.deepStrictEqual(
        keys.sort(),
        expectedKeys.sort(),
        `Role ${role} should have all permission keys`
      );
    }
  });

  it("all permission values are boolean", () => {
    const roles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];

    for (const role of roles) {
      const permissions = getEnterprisePermissions(role);
      const values = Object.values(permissions);

      for (const value of values) {
        assert.strictEqual(
          typeof value,
          "boolean",
          `Permission value for ${role} should be boolean`
        );
      }
    }
  });
});

describe("role hierarchy", () => {
  it("owner has more permissions than billing_admin", () => {
    const ownerPerms = getEnterprisePermissions("owner");
    const billingAdminPerms = getEnterprisePermissions("billing_admin");

    const ownerTrueCount = Object.values(ownerPerms).filter((v) => v).length;
    const billingAdminTrueCount = Object.values(billingAdminPerms).filter(
      (v) => v
    ).length;

    assert.ok(
      ownerTrueCount > billingAdminTrueCount,
      "Owner should have more permissions than billing_admin"
    );
  });

  it("owner has more permissions than org_admin", () => {
    const ownerPerms = getEnterprisePermissions("owner");
    const orgAdminPerms = getEnterprisePermissions("org_admin");

    const ownerTrueCount = Object.values(ownerPerms).filter((v) => v).length;
    const orgAdminTrueCount = Object.values(orgAdminPerms).filter((v) => v).length;

    assert.ok(
      ownerTrueCount > orgAdminTrueCount,
      "Owner should have more permissions than org_admin"
    );
  });

  it("billing_admin and org_admin have different permission sets", () => {
    const billingAdminPerms = getEnterprisePermissions("billing_admin");
    const orgAdminPerms = getEnterprisePermissions("org_admin");

    // billing_admin can manage billing but not create orgs
    // org_admin can create orgs but not manage billing
    assert.notStrictEqual(
      billingAdminPerms.canManageBilling,
      orgAdminPerms.canManageBilling,
      "Billing permission should differ"
    );
    assert.notStrictEqual(
      billingAdminPerms.canCreateSubOrg,
      orgAdminPerms.canCreateSubOrg,
      "CreateSubOrg permission should differ"
    );
  });

  it("all roles can view dashboard", () => {
    const roles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];

    for (const role of roles) {
      const permissions = getEnterprisePermissions(role);
      assert.strictEqual(
        permissions.canViewDashboard,
        true,
        `${role} should be able to view dashboard`
      );
    }
  });

  it("only owner can invite admins", () => {
    const roles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];

    for (const role of roles) {
      const permissions = getEnterprisePermissions(role);
      if (role === "owner") {
        assert.strictEqual(
          permissions.canInviteAdmins,
          true,
          "Owner should be able to invite admins"
        );
      } else {
        assert.strictEqual(
          permissions.canInviteAdmins,
          false,
          `${role} should not be able to invite admins`
        );
      }
    }
  });

  it("only owner can adopt organizations", () => {
    const roles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];

    for (const role of roles) {
      const permissions = getEnterprisePermissions(role);
      if (role === "owner") {
        assert.strictEqual(
          permissions.canAdoptOrg,
          true,
          "Owner should be able to adopt organizations"
        );
      } else {
        assert.strictEqual(
          permissions.canAdoptOrg,
          false,
          `${role} should not be able to adopt organizations`
        );
      }
    }
  });

  it("only owner can remove sub-organizations", () => {
    const roles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];

    for (const role of roles) {
      const permissions = getEnterprisePermissions(role);
      if (role === "owner") {
        assert.strictEqual(
          permissions.canRemoveSubOrg,
          true,
          "Owner should be able to remove sub-organizations"
        );
      } else {
        assert.strictEqual(
          permissions.canRemoveSubOrg,
          false,
          `${role} should not be able to remove sub-organizations`
        );
      }
    }
  });
});

describe("EnterpriseRolePermissions type", () => {
  it("has correct shape", () => {
    const permissions: EnterpriseRolePermissions = {
      canViewDashboard: true,
      canCreateSubOrg: false,
      canAdoptOrg: false,
      canRemoveSubOrg: false,
      canManageBilling: false,
      canInviteAdmins: false,
    };

    // Type check - this should compile
    assert.ok(typeof permissions.canViewDashboard === "boolean");
    assert.ok(typeof permissions.canCreateSubOrg === "boolean");
    assert.ok(typeof permissions.canAdoptOrg === "boolean");
    assert.ok(typeof permissions.canRemoveSubOrg === "boolean");
    assert.ok(typeof permissions.canManageBilling === "boolean");
    assert.ok(typeof permissions.canInviteAdmins === "boolean");
  });
});

describe("role type validation", () => {
  it("accepts valid role strings", () => {
    const validRoles: EnterpriseRole[] = ["owner", "billing_admin", "org_admin"];

    for (const role of validRoles) {
      // Should not throw
      const permissions = getEnterprisePermissions(role);
      assert.ok(permissions, `Should return permissions for ${role}`);
    }
  });
});
