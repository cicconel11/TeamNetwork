import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const panelPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "components",
  "settings",
  "LinkedInSettingsPanel.tsx",
);

const panelSource = fs.readFileSync(panelPath, "utf8");

test("linkedin settings panel keeps a retry path visible in error state", () => {
  assert.match(
    panelSource,
    /connection\?\.status === "error"/,
    "expected explicit error-state handling in the LinkedIn settings panel",
  );
  assert.match(
    panelSource,
    /Sync Now/,
    "expected the LinkedIn settings panel to keep the sync action available",
  );
  assert.match(
    panelSource,
    /syncing again|try syncing again|sync again/i,
    "expected error-state copy to describe retrying sync, not only reconnecting",
  );
});

test("linkedin settings panel shows an explicit disabled-integration state", () => {
  assert.match(
    panelSource,
    /oauthAvailable/,
    "expected the LinkedIn settings panel to receive oauth availability state",
  );
  assert.match(
    panelSource,
    /LinkedIn integration is not configured in this environment/,
    "expected the LinkedIn settings panel to explain when LinkedIn is disabled",
  );
  assert.doesNotMatch(
    panelSource,
    /Coming Soon/,
    "disabled LinkedIn should be described explicitly instead of as coming soon",
  );
});

test("linkedin settings panel does not use useAutoDismiss", () => {
  assert.doesNotMatch(panelSource, /useAutoDismiss/);
});

test("linkedin settings panel uses showFeedback for transient notifications", () => {
  assert.match(panelSource, /showFeedback/);
});

test("linkedin settings panel uses InlineBanner for inline errors", () => {
  assert.match(panelSource, /InlineBanner/);
});

test("linkedin settings panel distinguishes OIDC login rows from OAuth connections", () => {
  assert.ok(
    /source: "oauth" \| "oidc_login"/.test(panelSource) ||
      /source: LinkedInConnectionSource/.test(panelSource),
    "expected the panel connection type to expose the LinkedIn connection source",
  );
  assert.match(
    panelSource,
    /signed in with LinkedIn/i,
    "expected OIDC-specific copy explaining that login alone does not enable sync",
  );
});
