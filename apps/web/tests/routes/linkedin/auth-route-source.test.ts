import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const authRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "linkedin", "auth", "route.ts"),
  "utf8",
);
const connectRouteSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "user", "linkedin", "connect", "route.ts"),
  "utf8",
);

test("linkedin auth route redirects with an explicit disabled-integration code", () => {
  assert.match(
    authRouteSource,
    /LINKEDIN_INTEGRATION_DISABLED_CODE/,
    "expected auth route to use a shared disabled-integration code",
  );
  assert.match(
    authRouteSource,
    /errorUrl\.searchParams\.set\("error", LINKEDIN_INTEGRATION_DISABLED_CODE\)/,
    "expected auth route to redirect with the explicit disabled-integration error",
  );
  assert.match(
    authRouteSource,
    /getLinkedInIntegrationDisabledMessage/,
    "expected auth route to send a specific disabled-integration message",
  );
});

test("linkedin connect route returns 503 with an explicit disabled-integration code", () => {
  assert.match(
    connectRouteSource,
    /LINKEDIN_INTEGRATION_DISABLED_CODE/,
    "expected connect route to use a shared disabled-integration code",
  );
  assert.match(
    connectRouteSource,
    /status: 503/,
    "expected connect route to return 503 when LinkedIn is not configured",
  );
  assert.match(
    connectRouteSource,
    /code: LINKEDIN_INTEGRATION_DISABLED_CODE/,
    "expected connect route to include the explicit disabled-integration code in JSON",
  );
});
