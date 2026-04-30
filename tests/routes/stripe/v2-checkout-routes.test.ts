import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSource(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("v2 Stripe checkout routes", () => {
  const orgRoute = readSource("src/app/api/stripe/create-org-v2-checkout/route.ts");
  const enterpriseRoute = readSource("src/app/api/stripe/create-enterprise-v2-checkout/route.ts");

  it("org v2 route validates auth, schema, slug collision, sales mode, checkout metadata, and idempotency", () => {
    assert.match(orgRoute, /if \(!user\)[\s\S]*Unauthorized/);
    assert.match(orgRoute, /validateJson\(req, createOrgV2Schema/);
    assert.match(orgRoute, /serviceSupabase[\s\S]*\.from\("organizations"\)[\s\S]*\.eq\("slug", slug\)/);
    assert.match(orgRoute, /Slug is already taken/);
    assert.match(orgRoute, /isSelfServeSalesLed\(\{ tier: "single"/);
    assert.match(orgRoute, /return respond\(\{ mode: "sales", organizationSlug: org\.slug \}\)/);
    assert.match(orgRoute, /flowType: "org_v2_checkout"/);
    assert.match(orgRoute, /type: "org_v2"/);
    assert.match(orgRoute, /payment_attempt_id: claimedAttempt\.id/);
    assert.match(orgRoute, /stripe\.checkout\.sessions\.create/);
    assert.match(orgRoute, /success_url: `\$\{origin\}\/app\?org=\$\{slug\}&checkout=success`/);
    assert.match(orgRoute, /cancel_url: `\$\{origin\}\/app\/create-org\?checkout=cancel`/);
  });

  it("enterprise v2 route validates auth, schema, slug collision, sales mode, checkout metadata, and idempotency", () => {
    assert.match(enterpriseRoute, /if \(!user\)[\s\S]*Unauthorized/);
    assert.match(enterpriseRoute, /validateJson\(req, createEnterpriseV2Schema/);
    assert.match(enterpriseRoute, /\.from\("enterprises"\)[\s\S]*\.eq\("slug", slug\)/);
    assert.match(enterpriseRoute, /\.from\("organizations"\)[\s\S]*\.eq\("slug", slug\)/);
    assert.match(enterpriseRoute, /Slug is already taken/);
    assert.match(enterpriseRoute, /isSelfServeSalesLed\(\{ tier: "enterprise"/);
    assert.match(enterpriseRoute, /return respond\(\{ mode: "sales", enterpriseSlug: ent\.slug \}\)/);
    assert.match(enterpriseRoute, /flowType: "enterprise_v2_checkout"/);
    assert.match(enterpriseRoute, /type: "enterprise_v2"/);
    assert.match(enterpriseRoute, /payment_attempt_id: claimedAttempt\.id/);
    assert.match(enterpriseRoute, /stripe\.checkout\.sessions\.create/);
    assert.match(enterpriseRoute, /success_url: `\$\{origin\}\/app\?enterprise=\$\{slug\}&checkout=success`/);
    assert.match(enterpriseRoute, /cancel_url: `\$\{origin\}\/app\/create-enterprise\?checkout=cancel`/);
  });
});
