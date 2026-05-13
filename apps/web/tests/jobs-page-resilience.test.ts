import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("jobs page handles job-board query failures with a localized fallback", () => {
  const source = readSource("src/app/[orgSlug]/jobs/page.tsx");

  assert.match(source, /function renderJobsUnavailable/);
  assert.match(source, /filterOptionsResult\.error \|\| mainResult\.error/);
  assert.match(source, /tJobs\("unavailableTitle"\)/);
  assert.match(source, /tJobs\("unavailableDescription"\)/);
});

test("jobs unavailable fallback copy exists for every locale", () => {
  for (const locale of ["ar", "en", "es", "fr", "it", "pt", "zh"] as const) {
    const messages = JSON.parse(readSource(`messages/${locale}.json`)) as {
      jobs?: { unavailableTitle?: string; unavailableDescription?: string };
    };

    assert.ok(
      messages.jobs?.unavailableTitle,
      `${locale} should define jobs.unavailableTitle`,
    );
    assert.ok(
      messages.jobs?.unavailableDescription,
      `${locale} should define jobs.unavailableDescription`,
    );
  }
});
