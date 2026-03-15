import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pagePath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "settings",
  "linkedin",
  "page.tsx",
);

const pageSource = fs.readFileSync(pagePath, "utf8");

test("linkedin settings page refreshes status before surfacing sync failures", () => {
  assert.match(
    pageSource,
    /const refreshStatus = useCallback\(async \(\) =>/,
    "expected the settings page to share a reusable LinkedIn status refresh helper",
  );
  assert.match(
    pageSource,
    /if \(!res\.ok\) \{[\s\S]*await refreshStatus\(\);[\s\S]*throw new Error/,
    "expected failed sync responses to refresh LinkedIn status before surfacing the error",
  );
});
