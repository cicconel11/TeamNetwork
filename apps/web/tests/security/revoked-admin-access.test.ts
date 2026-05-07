import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regression guard: every confirmed-vulnerable destructive admin route
 * must route its caller through requireActiveOrgAdmin (or the equivalent
 * status-aware check) so a revoked admin cannot retain access. If a route
 * gets refactored back to the old role-only pattern this test fails.
 */

const A1_ROUTES = [
  "src/app/api/organizations/[organizationId]/route.ts",
  "src/app/api/organizations/[organizationId]/cancel-subscription/route.ts",
  "src/app/api/organizations/[organizationId]/resume-subscription/route.ts",
  "src/app/api/stripe/billing-portal/route.ts",
  "src/app/api/organizations/[organizationId]/members/[memberId]/reinstate/route.ts",
  "src/app/api/organizations/[organizationId]/adoption-requests/[requestId]/route.ts",
  "src/app/api/organizations/[organizationId]/adoption-requests/[requestId]/accept/route.ts",
  "src/app/api/organizations/[organizationId]/adoption-requests/[requestId]/reject/route.ts",
  "src/app/api/organizations/[organizationId]/start-checkout/route.ts",
  "src/app/api/organizations/[organizationId]/reconcile-subscription/route.ts",
];

const ROOT = resolve(__dirname, "../..");

for (const relPath of A1_ROUTES) {
  test(`${relPath} uses requireActiveOrgAdmin`, () => {
    const source = readFileSync(resolve(ROOT, relPath), "utf8");
    assert.match(
      source,
      /requireActiveOrgAdmin/,
      `${relPath} must import + call requireActiveOrgAdmin to enforce status check`
    );
    assert.doesNotMatch(
      source,
      /role\?\.role !== "admin"\s*\)\s*\{?\s*\n?\s*return respond\(\s*\{\s*error: "Forbidden"\s*\}/,
      `${relPath} still uses raw role-only check that ignores status`
    );
  });
}
