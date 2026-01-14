import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Tests for alumni count consistency across the codebase.
 *
 * BUG: checkAlumniCapacity in graduation/queries.ts counted alumni from
 * user_organization_roles (role='alumni', status='active') while every other
 * counter (dashboard, subscription API, DB functions) counts from the alumni
 * table (deleted_at IS NULL). This means:
 *
 * - Manually added alumni (no user account) are invisible to the graduation
 *   cron's capacity check, allowing it to exceed quota.
 * - The graduation cron could create more alumni than the subscription allows
 *   because it sees fewer alumni than actually exist.
 *
 * FIX: Changed checkAlumniCapacity to count from the alumni table, matching
 * all other counting locations.
 */

describe("Alumni Count Consistency", () => {
  describe("All alumni counting methods should agree", () => {
    it("should demonstrate the bug: user_organization_roles undercounts when manual alumni exist", () => {
      // Simulate an org that has:
      // - 3 alumni in the alumni table (2 with user accounts, 1 manually added)
      // - 2 alumni in user_organization_roles (only those with user accounts)
      const alumniTableRows = [
        { id: "a1", user_id: "u1", organization_id: "org1", deleted_at: null },
        { id: "a2", user_id: "u2", organization_id: "org1", deleted_at: null },
        { id: "a3", user_id: null, organization_id: "org1", deleted_at: null }, // manual add, no user account
      ];

      const userOrgRoles = [
        { user_id: "u1", organization_id: "org1", role: "alumni", status: "active" },
        { user_id: "u2", organization_id: "org1", role: "alumni", status: "active" },
      ];

      // Old (buggy) counting: from user_organization_roles
      const buggyCount = userOrgRoles.filter(
        (r) => r.organization_id === "org1" && r.role === "alumni" && r.status === "active"
      ).length;

      // New (fixed) counting: from alumni table
      const fixedCount = alumniTableRows.filter(
        (a) => a.organization_id === "org1" && a.deleted_at === null
      ).length;

      // The buggy count misses the manually added alumni
      assert.strictEqual(buggyCount, 2, "Buggy count only sees role-linked alumni");
      assert.strictEqual(fixedCount, 3, "Fixed count sees all alumni including manual adds");
      assert.notStrictEqual(buggyCount, fixedCount, "Counts diverge when manual alumni exist");
    });

    it("should show quota can be exceeded with buggy count", () => {
      const alumniLimit = 3; // org pays for up to 3 alumni

      // 2 role-linked alumni + 1 manually added = 3 total in alumni table
      const alumniTableCount = 3;
      const userOrgRolesCount = 2;

      // Buggy: graduation cron thinks there's capacity (2 < 3)
      const buggyHasCapacity = userOrgRolesCount < alumniLimit;
      assert.strictEqual(buggyHasCapacity, true, "Buggy logic thinks there's capacity");

      // Fixed: correctly sees org is at capacity (3 < 3 is false)
      const fixedHasCapacity = alumniTableCount < alumniLimit;
      assert.strictEqual(fixedHasCapacity, false, "Fixed logic correctly sees org is at capacity");
    });

    it("should agree when all alumni have user accounts (no manual adds)", () => {
      // When there are no manually added alumni, both counts should agree
      const alumniTableRows = [
        { id: "a1", user_id: "u1", organization_id: "org1", deleted_at: null },
        { id: "a2", user_id: "u2", organization_id: "org1", deleted_at: null },
      ];

      const userOrgRoles = [
        { user_id: "u1", organization_id: "org1", role: "alumni", status: "active" },
        { user_id: "u2", organization_id: "org1", role: "alumni", status: "active" },
      ];

      const alumniTableCount = alumniTableRows.filter(
        (a) => a.organization_id === "org1" && a.deleted_at === null
      ).length;

      const rolesCount = userOrgRoles.filter(
        (r) => r.organization_id === "org1" && r.role === "alumni" && r.status === "active"
      ).length;

      assert.strictEqual(alumniTableCount, rolesCount, "Counts agree when all alumni have user accounts");
    });

    it("should correctly exclude soft-deleted alumni", () => {
      const alumniTableRows = [
        { id: "a1", user_id: "u1", organization_id: "org1", deleted_at: null },
        { id: "a2", user_id: "u2", organization_id: "org1", deleted_at: "2025-06-01T00:00:00Z" }, // reinstated
        { id: "a3", user_id: null, organization_id: "org1", deleted_at: null },
      ];

      const activeCount = alumniTableRows.filter(
        (a) => a.organization_id === "org1" && a.deleted_at === null
      ).length;

      assert.strictEqual(activeCount, 2, "Soft-deleted alumni should not be counted");
    });

    it("should handle multi-org counts independently", () => {
      const alumniTableRows = [
        { id: "a1", user_id: "u1", organization_id: "org1", deleted_at: null },
        { id: "a2", user_id: "u2", organization_id: "org1", deleted_at: null },
        { id: "a3", user_id: "u3", organization_id: "org2", deleted_at: null },
        { id: "a4", user_id: null, organization_id: "org2", deleted_at: null },
        { id: "a5", user_id: null, organization_id: "org2", deleted_at: null },
      ];

      const org1Count = alumniTableRows.filter(
        (a) => a.organization_id === "org1" && a.deleted_at === null
      ).length;

      const org2Count = alumniTableRows.filter(
        (a) => a.organization_id === "org2" && a.deleted_at === null
      ).length;

      assert.strictEqual(org1Count, 2, "Org1 should have 2 alumni");
      assert.strictEqual(org2Count, 3, "Org2 should have 3 alumni");
    });
  });

  describe("checkAlumniCapacity uses alumni table", () => {
    it("should verify the fix is in place by checking source code", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");

      const queriesPath = path.join(
        process.cwd(),
        "src",
        "lib",
        "graduation",
        "queries.ts"
      );

      const source = fs.readFileSync(queriesPath, "utf-8");

      // The fix: checkAlumniCapacity should query from "alumni" table
      assert.ok(
        source.includes('.from("alumni")'),
        "checkAlumniCapacity should query from the alumni table"
      );

      // It should filter by deleted_at
      assert.ok(
        source.includes('.is("deleted_at", null)'),
        "Query should filter out soft-deleted alumni"
      );

      // It should NOT query user_organization_roles for counting alumni
      // (it can still query it for other purposes like getOrgAdminEmails)
      const capacityFnMatch = source.match(
        /async function checkAlumniCapacity[\s\S]*?^}/m
      );

      assert.ok(capacityFnMatch, "checkAlumniCapacity function should exist");

      const capacityFnBody = capacityFnMatch![0];

      assert.ok(
        !capacityFnBody.includes('from("user_organization_roles")'),
        "checkAlumniCapacity should not count from user_organization_roles"
      );

      assert.ok(
        capacityFnBody.includes('from("alumni")'),
        "checkAlumniCapacity should count from alumni table"
      );
    });
  });
});
