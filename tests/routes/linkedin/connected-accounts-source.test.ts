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
  "connected-accounts",
  "page.tsx",
);

const pageSource = fs.readFileSync(pagePath, "utf8");

test("connected accounts page redirects to notifications", () => {
  assert.match(
    pageSource,
    /redirect\("\/settings\/notifications"\)/,
    "expected connected accounts page to redirect to notifications settings",
  );
});

test("connected accounts page does not contain client-side logic", () => {
  assert.doesNotMatch(
    pageSource,
    /use client/,
    "expected connected accounts page to be a server component (redirect)",
  );
  assert.doesNotMatch(
    pageSource,
    /useState/,
    "expected connected accounts page to contain no client state",
  );
});
