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

test("connected accounts page renders the LinkedIn settings experience", () => {
  assert.match(
    pageSource,
    /LinkedInSettingsPanel/,
    "expected connected accounts page to render the LinkedIn settings panel",
  );
  assert.match(
    pageSource,
    /useLinkedIn/,
    "expected connected accounts page to load LinkedIn connection state",
  );
});

test("connected accounts page is a client component instead of a redirect shim", () => {
  assert.match(
    pageSource,
    /use client/,
    "expected connected accounts page to be a client component",
  );
  assert.doesNotMatch(
    pageSource,
    /redirect\("\/settings\/notifications"\)/,
    "expected connected accounts page to stop redirecting to notifications",
  );
});
