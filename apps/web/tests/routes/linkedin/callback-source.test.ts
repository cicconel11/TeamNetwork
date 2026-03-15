import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const callbackPath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "linkedin",
  "callback.ts",
);

const callbackSource = fs.readFileSync(callbackPath, "utf8");

test("linkedin callback syncs org profile fields after storing the connection", () => {
  assert.match(
    callbackSource,
    /syncLinkedInProfileFields/,
    "expected callback to reuse the shared LinkedIn org-profile propagation helper",
  );
  assert.match(
    callbackSource,
    /const syncResult = await syncLinkedInProfileFields\(serviceClient, user\.id, tokens\.profile\);/,
    "expected callback to sync org-facing profile fields after storing the LinkedIn connection",
  );
});

test("linkedin callback keeps the connection and redirects with a warning when org profile sync fails", () => {
  assert.match(
    callbackSource,
    /if \(!syncResult\.success\) \{/,
    "expected callback to branch on org profile sync failures",
  );
  assert.match(
    callbackSource,
    /await recordLinkedInSyncWarning\(/,
    "expected callback to persist a non-fatal sync warning on the LinkedIn connection",
  );
  assert.match(
    callbackSource,
    /buildSuccessRedirect\([\s\S]*warning:\s*"profile_sync_failed"[\s\S]*warning_message:/,
    "expected callback to redirect as connected while surfacing a sync warning",
  );
});
