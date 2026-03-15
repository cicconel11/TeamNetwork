import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "app",
  "auth",
  "callback",
  "route.ts",
);

const routeSource = fs.readFileSync(routePath, "utf8");

test("auth callback schedules LinkedIn OIDC sync without awaiting the redirect path", () => {
  assert.match(
    routeSource,
    /LINKEDIN_OIDC_PROVIDER/,
    "expected auth callback to use the LINKEDIN_OIDC_PROVIDER constant (not a raw string)",
  );
  assert.match(
    routeSource,
    /queueMicrotask\(\(\)\s*=>\s*\{\s*void runLinkedInOidcSyncSafe\(createServiceClient, data\.session\.user\);?\s*\}\)/,
    "auth callback must schedule runLinkedInOidcSyncSafe in a microtask so login redirect is not blocked",
  );
  assert.doesNotMatch(
    routeSource,
    /await runLinkedInOidcSyncSafe\(createServiceClient, data\.session\.user\)/,
    "auth callback must not await runLinkedInOidcSyncSafe on the redirect path",
  );
});
