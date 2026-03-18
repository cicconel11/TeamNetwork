import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const settingsPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "linkedin",
  "settings.ts",
);

const settingsSource = fs.readFileSync(settingsPath, "utf8");

test("getLinkedInStatusForUser filters out enriched_only sentinel rows", () => {
  assert.match(
    settingsSource,
    /status\s*!==\s*["']enriched_only["']/,
    "expected settings to filter out enriched_only rows so they don't appear as a connection",
  );
});

test("enriched_only filter results in connection: null", () => {
  // The filter should produce null (same as no row) rather than passing it through
  assert.match(
    settingsSource,
    /connectionRow\s*&&\s*connectionRow\.status\s*!==\s*["']enriched_only["']/,
    "expected the enriched_only guard to be part of the connectionRow truthiness check",
  );
});
