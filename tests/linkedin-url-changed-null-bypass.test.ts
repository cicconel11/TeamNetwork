import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const oauthPath = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "lib",
  "linkedin",
  "oauth.ts",
);

const oauthSource = fs.readFileSync(oauthPath, "utf8");

test("urlChanged treats NULL last_enriched_url as changed (allows bypass)", () => {
  const fnStart = oauthSource.indexOf("export async function runProxycurlEnrichment");
  assert.ok(fnStart > -1, "expected runProxycurlEnrichment function");

  const fnBody = oauthSource.slice(fnStart);

  // The urlChanged line should use `== null ||` (treat null as changed)
  // NOT `!= null &&` (treat null as not-changed, blocking bypass)
  assert.match(
    fnBody,
    /last_enriched_url\s*==\s*null/,
    "urlChanged should treat null last_enriched_url as changed (== null)",
  );

  // Ensure the OLD blocking pattern is NOT present
  assert.doesNotMatch(
    fnBody,
    /last_enriched_url\s*!=\s*null\s*&&/,
    "should NOT have the old != null && pattern that blocks null URLs",
  );
});
