import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-grep tests for alumni pagination.
 *
 * Rationale: the page is a Server Component that composes `next-intl`,
 * Supabase SSR, and Next 14 routing — instantiating it in a unit test
 * requires non-trivial scaffolding. These tests lock in the pagination
 * contract at the source level (PAGE_SIZE, range(), count:"exact", nav
 * links) and complement the pagination behavior already exercised by
 * the parents directory tests.
 */

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("alumni page declares a 50-row page size and a facet row cap", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  assert.match(source, /const PAGE_SIZE = 50;/);
  assert.match(source, /const FACET_ROW_CAP = 5000;/);
});

test("alumni page accepts a page search param", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  assert.match(source, /page\?: string;/);
});

test("alumni query uses count:\"exact\" and a range window", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  assert.match(source, /\{ count: "exact" \}/);
  assert.match(source, /\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
});

test("alumni pagination preserves active filters across page links", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  const searchSection = source.slice(source.indexOf("filterParams"));
  assert.match(searchSection, /filterParams\.set\("year"/);
  assert.match(searchSection, /filterParams\.set\("industry"/);
  assert.match(searchSection, /filterParams\.set\("company"/);
  assert.match(searchSection, /filterParams\.set\("city"/);
  assert.match(searchSection, /filterParams\.set\("position"/);
  assert.match(source, /\$\{paginationBase\}page=\$\{currentPage - 1\}/);
  assert.match(source, /\$\{paginationBase\}page=\$\{currentPage \+ 1\}/);
});

test("alumni facet query is capped to the declared facet row cap", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  assert.match(source, /\.limit\(FACET_ROW_CAP\)/);
});
