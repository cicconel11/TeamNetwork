import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const alumniPageSource = readFileSync(
  resolve(__dirname, "../src/app/[orgSlug]/alumni/page.tsx"),
  "utf-8"
);

describe("Alumni page query (regression)", () => {
  it("does not select user_id from the alumni table", () => {
    // The alumni table has no user_id column.
    // Selecting it causes Supabase to silently return null data.
    const selectBlocks = alumniPageSource.match(/\.select\(`[^`]*`\)/g) || [];
    for (const block of selectBlocks) {
      assert.ok(
        !block.includes("user_id"),
        `Found user_id in select: ${block}`
      );
    }
  });

  it("does not filter alumni by user_id", () => {
    // Filtering by user_id on the alumni table is invalid — the column doesn't exist.
    assert.ok(
      !alumniPageSource.includes('.in("user_id"'),
      "Found .in(\"user_id\" filter on alumni query"
    );
    assert.ok(
      !alumniPageSource.includes('.eq("user_id"'),
      "Found .eq(\"user_id\" filter on alumni query"
    );
  });

  it("queries alumni table with organization_id filter", () => {
    assert.ok(
      alumniPageSource.includes('.eq("organization_id"'),
      "Missing organization_id filter on alumni query"
    );
  });

  it("queries alumni table with deleted_at IS NULL filter", () => {
    assert.ok(
      alumniPageSource.includes('.is("deleted_at", null)'),
      "Missing deleted_at IS NULL filter on alumni query"
    );
  });

  it("does not reference AlumniWithAdminFlag type", () => {
    assert.ok(
      !alumniPageSource.includes("AlumniWithAdminFlag"),
      "Found stale AlumniWithAdminFlag type reference"
    );
  });

  it("does not render isAdmin badge", () => {
    assert.ok(
      !alumniPageSource.includes("isAdmin"),
      "Found isAdmin reference — should be removed"
    );
  });
});
