import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-grep tests for the members-directory pragmatic cap and
 * truncation banner. Offset pagination across a union of three tables
 * is incorrect, so this PR ships a fixed per-source cap + banner; a
 * follow-up PR will replace the union with a paginating RPC.
 */

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("members page declares SOURCE_CAP = 500", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /const SOURCE_CAP = 500;/);
});

test("members page caps linked + manual + parent source queries", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /linkedMembersQuery = linkedMembersQuery\.order\("last_name"\)\.limit\(SOURCE_CAP\)/);
  assert.match(source, /manualMembersQuery = manualMembersQuery\.order\("last_name"\)\.limit\(SOURCE_CAP\)/);
  assert.match(source, /parentProfilesQuery = parentProfilesQuery\.order\("last_name"\)\.limit\(SOURCE_CAP\)/);
});

test("members page computes isTruncated from any source hitting the cap", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /const isTruncated =\s*\n\s*\(linkedMembers\?\.length \?\? 0\) >= SOURCE_CAP/);
  assert.match(source, /\(manualMembers\?\.length \?\? 0\) >= SOURCE_CAP/);
  assert.match(source, /\(parentProfiles\?\.length \?\? 0\) >= SOURCE_CAP/);
});

test("members page renders a truncation banner when truncated", () => {
  const source = readSource("src/app/[orgSlug]/members/page.tsx");
  assert.match(source, /\{isTruncated &&/);
  assert.match(source, /data-testid="members-truncation-banner"/);
});
