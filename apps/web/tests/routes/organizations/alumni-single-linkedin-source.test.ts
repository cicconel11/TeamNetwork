import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("alumni actions menu exposes a distinct single LinkedIn action", () => {
  const source = readSource("src/components/alumni/AddAlumniMenu.tsx");

  assert.ok(
    source.includes("Attach LinkedIn URL"),
    "menu should expose a standalone single LinkedIn action"
  );
  assert.ok(
    source.includes("Bulk Import LinkedIn URLs"),
    "menu should keep the bulk LinkedIn import as a distinct action"
  );
  assert.ok(
    source.indexOf("Attach LinkedIn URL") < source.indexOf("Add Single Alumni"),
    "single LinkedIn action should appear before Add Single Alumni in the dropdown"
  );
});

test("alumni import panel receives orgSlug so the single LinkedIn flow can hand off to Add Alumni", () => {
  const source = readSource("src/app/[orgSlug]/alumni/page.tsx");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("<AlumniImportPanel organizationId={org.id} orgSlug={orgSlug} />"),
    "alumni page should pass orgSlug into the shared admin action panel"
  );
});

test("new alumni page prefills linkedin_url from the URL query string", () => {
  const source = readSource("src/app/[orgSlug]/alumni/new/page.tsx");
  const normalized = squishWhitespace(source);

  assert.ok(
    source.includes("useSearchParams"),
    "new alumni page should read search params for prefill support"
  );
  assert.ok(
    normalized.includes('const prefilledLinkedinUrl = searchParams.get("linkedin_url") ?? "";'),
    "new alumni page should derive a prefilled LinkedIn URL from the query string"
  );
  assert.ok(
    normalized.includes('linkedin_url: prefilledLinkedinUrl,'),
    "new alumni form should seed the linkedin_url field from the prefilled query value"
  );
});

test("bulk LinkedIn importer no longer offers the broken spreadsheet paste affordance", () => {
  const source = readSource("src/components/alumni/BulkLinkedInImporter.tsx");

  assert.strictEqual(
    source.includes("ImportPasteArea"),
    false,
    "bulk LinkedIn importer should not render the spreadsheet paste UI"
  );
  assert.strictEqual(
    source.includes("Paste from spreadsheet"),
    false,
    "bulk LinkedIn importer should not mention spreadsheet paste"
  );
});

test("single LinkedIn panel exposes create-new directly from a valid URL flow", () => {
  const source = readSource("src/components/alumni/SingleLinkedInAttacher.tsx");

  assert.ok(
    source.includes("Create New Alumni"),
    "single LinkedIn panel should provide a create-new action"
  );
  assert.ok(
    source.includes("Use this LinkedIn URL as the starting point"),
    "single LinkedIn panel should explain the create-new handoff"
  );
  assert.equal(
    (source.match(/Create New Alumni/g) ?? []).length,
    1,
    "single LinkedIn panel should expose only one Create New Alumni action"
  );
});

test("single LinkedIn panel no-match state points admins back to the primary create action", () => {
  const source = readSource("src/components/alumni/SingleLinkedInAttacher.tsx");

  assert.ok(
    source.includes("No alumni matched that search. Use the action above to start a new record with this LinkedIn URL."),
    "no-match state should avoid rendering a second Create New Alumni button"
  );
});
