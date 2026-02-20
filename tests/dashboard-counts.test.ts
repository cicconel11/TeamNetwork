import { describe, it, before } from "node:test";
import assert from "node:assert";

/**
 * Tests for dashboard count correctness.
 *
 * BUG 1: The "Active Members" count on the dashboard filtered only
 * `deleted_at IS NULL` but did NOT exclude graduated members
 * (`graduated_at IS NOT NULL`). When the graduation cron transitions
 * members to alumni, they remained in the "Active Members" count.
 *
 * FIX: Added `.filter("graduated_at", "is", "null")` to the members
 * count query in src/app/[orgSlug]/page.tsx.
 *
 * BUG 2: Dashboard served stale data from Next.js Router Cache after
 * alumni were added/removed on other pages.
 *
 * FIX: Added `export const dynamic = "force-dynamic"` to the dashboard
 * page to ensure fresh data on every navigation.
 */

describe("Dashboard Counts", () => {
  describe("Active Members count excludes graduated members", () => {
    it("should count only non-graduated, non-deleted members", () => {
      const members = [
        { id: "m1", organization_id: "org1", deleted_at: null, graduated_at: null },
        { id: "m2", organization_id: "org1", deleted_at: null, graduated_at: null },
        { id: "m3", organization_id: "org1", deleted_at: null, graduated_at: "2025-05-15T00:00:00Z" },
        { id: "m4", organization_id: "org1", deleted_at: "2025-04-01T00:00:00Z", graduated_at: null },
      ];

      // Correct filter: both deleted_at and graduated_at must be null
      const activeCount = members.filter(
        (m) => m.organization_id === "org1" && m.deleted_at === null && m.graduated_at === null
      ).length;

      assert.strictEqual(activeCount, 2, "Only non-graduated, non-deleted members should be counted");
    });

    it("should demonstrate the bug: old query overcounts by including graduated members", () => {
      const members = [
        { id: "m1", organization_id: "org1", deleted_at: null, graduated_at: null },
        { id: "m2", organization_id: "org1", deleted_at: null, graduated_at: "2025-05-15T00:00:00Z" },
        { id: "m3", organization_id: "org1", deleted_at: null, graduated_at: "2025-06-01T00:00:00Z" },
      ];

      // Old (buggy) query: only filters deleted_at
      const buggyCount = members.filter(
        (m) => m.organization_id === "org1" && m.deleted_at === null
      ).length;

      // New (fixed) query: filters both deleted_at and graduated_at
      const fixedCount = members.filter(
        (m) => m.organization_id === "org1" && m.deleted_at === null && m.graduated_at === null
      ).length;

      assert.strictEqual(buggyCount, 3, "Buggy count includes graduated members");
      assert.strictEqual(fixedCount, 1, "Fixed count excludes graduated members");
      assert.notStrictEqual(buggyCount, fixedCount, "Counts diverge when graduated members exist");
    });

    it("should agree with old query when no members are graduated", () => {
      const members = [
        { id: "m1", organization_id: "org1", deleted_at: null, graduated_at: null },
        { id: "m2", organization_id: "org1", deleted_at: null, graduated_at: null },
      ];

      const oldCount = members.filter(
        (m) => m.organization_id === "org1" && m.deleted_at === null
      ).length;

      const newCount = members.filter(
        (m) => m.organization_id === "org1" && m.deleted_at === null && m.graduated_at === null
      ).length;

      assert.strictEqual(oldCount, newCount, "Counts agree when no members are graduated");
    });
  });

  describe("Alumni count excludes soft-deleted records", () => {
    it("should count only non-deleted alumni", () => {
      const alumni = [
        { id: "a1", organization_id: "org1", deleted_at: null },
        { id: "a2", organization_id: "org1", deleted_at: null },
        { id: "a3", organization_id: "org1", deleted_at: "2025-06-01T00:00:00Z" },
      ];

      const alumniCount = alumni.filter(
        (a) => a.organization_id === "org1" && a.deleted_at === null
      ).length;

      assert.strictEqual(alumniCount, 2, "Soft-deleted alumni should not be counted");
    });

    it("should return zero when all alumni are soft-deleted", () => {
      const alumni = [
        { id: "a1", organization_id: "org1", deleted_at: "2025-06-01T00:00:00Z" },
        { id: "a2", organization_id: "org1", deleted_at: "2025-07-01T00:00:00Z" },
      ];

      const alumniCount = alumni.filter(
        (a) => a.organization_id === "org1" && a.deleted_at === null
      ).length;

      assert.strictEqual(alumniCount, 0, "All soft-deleted alumni should result in zero count");
    });
  });

  /**
   * Source-verification tests: these are regression guardrails that confirm
   * the fix remains in place. They use regex patterns to tolerate formatting
   * changes (line wrapping, whitespace, quote style).
   */
  describe("Dashboard source code verification", () => {
    let source: string;

    before(async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dashboardPath = path.join(
        process.cwd(),
        "src",
        "app",
        "[orgSlug]",
        "page.tsx"
      );
      source = fs.readFileSync(dashboardPath, "utf-8");
    });

    it("should have force-dynamic export to prevent stale cache", () => {
      assert.match(
        source,
        /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
        "Dashboard should export dynamic = force-dynamic to prevent stale data"
      );
    });

    it("should filter graduated_at in the members count query", () => {
      // Match either .is("graduated_at", null) or .filter("graduated_at", "is", "null")
      assert.match(
        source,
        /\.(?:is|filter)\(["']graduated_at["']/,
        "Members count query should filter out graduated members"
      );
    });

    it("should filter deleted_at on the members count query", () => {
      // Verify the members query contains both deleted_at and graduated_at filters.
      // Use a multiline regex that spans from the members .from() to the next query.
      const membersBlock = source.match(
        /\.from\(["']members["']\)[\s\S]*?(?=\.from\(["']alumni["']\))/
      );

      assert.ok(membersBlock, "Should have a members query block");
      assert.match(
        membersBlock![0],
        /\.is\(["']deleted_at["'],\s*null\)/,
        "Members query should filter deleted_at"
      );
      assert.match(
        membersBlock![0],
        /\.(?:is|filter)\(["']graduated_at["']/,
        "Members query should also filter graduated_at"
      );
    });

    it("should filter deleted_at on the alumni count query", () => {
      const alumniBlock = source.match(
        /\.from\(["']alumni["']\)[\s\S]*?(?=\.from\(["']events["']\))/
      );

      assert.ok(alumniBlock, "Should have an alumni query block");
      assert.match(
        alumniBlock![0],
        /\.is\(["']deleted_at["'],\s*null\)/,
        "Alumni query should filter deleted_at"
      );
    });
  });
});
