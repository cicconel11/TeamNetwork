/**
 * Tests for alumni page editRoles navigation configuration.
 *
 * Verifies that canEditNavItem correctly gates alumni page
 * CRUD operations based on the org's nav_config.editRoles setting.
 *
 * The alumni page should respect editRoles the same way
 * donations and philanthropy pages do.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { canEditNavItem, getNavEditRoles } from "../src/lib/navigation/permissions.ts";
import type { NavConfig } from "../src/lib/navigation/nav-items.tsx";
import type { OrgRole } from "../src/lib/auth/role-utils.ts";

const ALUMNI_PATH = "/alumni";
const ALUMNI_FALLBACK: OrgRole[] = ["admin"];

describe("Alumni Page Edit Roles", () => {
  describe("Default config (no editRoles set)", () => {
    const noConfig: NavConfig | null = null;
    const emptyConfig: NavConfig = {};

    it("admin can edit alumni page with null config", () => {
      assert.strictEqual(
        canEditNavItem(noConfig, ALUMNI_PATH, "admin", ALUMNI_FALLBACK),
        true
      );
    });

    it("admin can edit alumni page with empty config", () => {
      assert.strictEqual(
        canEditNavItem(emptyConfig, ALUMNI_PATH, "admin", ALUMNI_FALLBACK),
        true
      );
    });

    it("active_member cannot edit alumni page by default", () => {
      assert.strictEqual(
        canEditNavItem(noConfig, ALUMNI_PATH, "active_member", ALUMNI_FALLBACK),
        false
      );
    });

    it("alumni cannot edit alumni page by default", () => {
      assert.strictEqual(
        canEditNavItem(noConfig, ALUMNI_PATH, "alumni", ALUMNI_FALLBACK),
        false
      );
    });

    it("null role cannot edit alumni page", () => {
      assert.strictEqual(
        canEditNavItem(noConfig, ALUMNI_PATH, null, ALUMNI_FALLBACK),
        false
      );
    });
  });

  describe("With editRoles: ['admin', 'alumni']", () => {
    const config: NavConfig = {
      "/alumni": { editRoles: ["admin", "alumni"] },
    };

    it("admin can edit alumni page", () => {
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "admin", ALUMNI_FALLBACK),
        true
      );
    });

    it("alumni can edit alumni page when granted", () => {
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "alumni", ALUMNI_FALLBACK),
        true
      );
    });

    it("active_member still cannot edit when not in editRoles", () => {
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "active_member", ALUMNI_FALLBACK),
        false
      );
    });

    it("null role cannot edit even with editRoles set", () => {
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, null, ALUMNI_FALLBACK),
        false
      );
    });
  });

  describe("With editRoles: ['admin', 'active_member']", () => {
    const config: NavConfig = {
      "/alumni": { editRoles: ["admin", "active_member"] },
    };

    it("active_member can edit alumni page when granted", () => {
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "active_member", ALUMNI_FALLBACK),
        true
      );
    });

    it("alumni cannot edit when not in editRoles", () => {
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "alumni", ALUMNI_FALLBACK),
        false
      );
    });
  });

  describe("With editRoles: ['admin', 'active_member', 'alumni']", () => {
    const config: NavConfig = {
      "/alumni": { editRoles: ["admin", "active_member", "alumni"] },
    };

    it("all roles can edit alumni page", () => {
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "admin", ALUMNI_FALLBACK),
        true
      );
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "active_member", ALUMNI_FALLBACK),
        true
      );
      assert.strictEqual(
        canEditNavItem(config, ALUMNI_PATH, "alumni", ALUMNI_FALLBACK),
        true
      );
    });
  });

  describe("getNavEditRoles for alumni path", () => {
    it("returns fallback ['admin'] when no config", () => {
      const roles = getNavEditRoles(null, ALUMNI_PATH, ALUMNI_FALLBACK);
      assert.deepStrictEqual(roles, ["admin"]);
    });

    it("returns configured roles plus admin when editRoles set", () => {
      const config: NavConfig = {
        "/alumni": { editRoles: ["alumni"] },
      };
      const roles = getNavEditRoles(config, ALUMNI_PATH, ALUMNI_FALLBACK);
      assert.ok(roles.includes("admin"), "admin should always be included");
      assert.ok(roles.includes("alumni"), "alumni should be included from config");
    });

    it("deduplicates admin when already in editRoles", () => {
      const config: NavConfig = {
        "/alumni": { editRoles: ["admin", "alumni"] },
      };
      const roles = getNavEditRoles(config, ALUMNI_PATH, ALUMNI_FALLBACK);
      const adminCount = roles.filter((r) => r === "admin").length;
      assert.strictEqual(adminCount, 1, "admin should appear exactly once");
    });
  });

  describe("Self-edit pathway (detail page)", () => {
    // The detail page should combine canEditNavItem with a self-edit check:
    // canEdit = canEditPage || isSelf
    // This ensures alumni can always edit their own profile even without editRoles

    it("alumni without editRoles CAN edit own profile (self-edit)", () => {
      const canEditPage = canEditNavItem(null, ALUMNI_PATH, "alumni", ALUMNI_FALLBACK);
      const isSelf = true; // user_id matches alumni record
      const canEdit = canEditPage || isSelf;
      assert.strictEqual(canEdit, true, "Self-edit should allow editing own profile");
    });

    it("alumni without editRoles CANNOT edit others' profiles", () => {
      const canEditPage = canEditNavItem(null, ALUMNI_PATH, "alumni", ALUMNI_FALLBACK);
      const isSelf = false;
      const canEdit = canEditPage || isSelf;
      assert.strictEqual(canEdit, false, "Alumni cannot edit other profiles without editRoles");
    });

    it("alumni WITH editRoles CAN edit others' profiles", () => {
      const config: NavConfig = {
        "/alumni": { editRoles: ["admin", "alumni"] },
      };
      const canEditPage = canEditNavItem(config, ALUMNI_PATH, "alumni", ALUMNI_FALLBACK);
      const isSelf = false;
      const canEdit = canEditPage || isSelf;
      assert.strictEqual(canEdit, true, "Alumni with editRoles can edit any profile");
    });
  });

  describe("Does not affect other pages", () => {
    it("alumni editRoles config does not affect donations path", () => {
      const config: NavConfig = {
        "/alumni": { editRoles: ["admin", "alumni"] },
      };
      assert.strictEqual(
        canEditNavItem(config, "/donations", "alumni", ["admin"]),
        false,
        "Alumni editRoles on /alumni should not grant access to /donations"
      );
    });
  });
});
