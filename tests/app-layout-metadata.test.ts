import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("root layout declares explicit versioned TeamNetwork icons", () => {
  const source = readFileSync("src/app/layout.tsx", "utf8");

  assert.match(source, /const ICON_VERSION = "tn-20260325"/);
  assert.match(source, /icons:\s*\{/);
  assert.match(source, /url: `\/favicon\.ico\?v=\$\{ICON_VERSION\}`/);
  assert.match(source, /url: `\/icon\.png\?v=\$\{ICON_VERSION\}`/);
  assert.match(source, /url: `\/apple-icon\.png\?v=\$\{ICON_VERSION\}`/);
});
