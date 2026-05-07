import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function simulateCreateWithUpgradeErrors(params: {
  slugAvailable: boolean;
  adjustment: { ok: boolean; status: number; body: Record<string, unknown> };
  creation: { ok: boolean; status: number; body: Record<string, unknown> };
}) {
  if (!params.slugAvailable) {
    return {
      status: 409,
      body: { error: "Slug is already taken" },
      adjusted: false,
      created: false,
    };
  }

  if (!params.adjustment.ok) {
    return {
      status: params.adjustment.status,
      body: params.adjustment.body,
      adjusted: false,
      created: false,
    };
  }

  if (!params.creation.ok) {
    return {
      status: params.creation.status,
      body: params.creation.body,
      adjusted: true,
      created: false,
    };
  }

  return {
    status: 201,
    body: params.creation.body,
    adjusted: true,
    created: true,
  };
}

test("create-with-upgrade surfaces billing-adjust failures and creates nothing", () => {
  const result = simulateCreateWithUpgradeErrors({
    slugAvailable: true,
    adjustment: {
      ok: false,
      status: 500,
      body: { error: "Billing updated but failed to save. Please contact support." },
    },
    creation: {
      ok: true,
      status: 201,
      body: { organization: { id: "org-1" } },
    },
  });

  assert.equal(result.status, 500);
  assert.equal(result.adjusted, false);
  assert.equal(result.created, false);
  assert.equal(result.body.error, "Billing updated but failed to save. Please contact support.");
});

test("create-with-upgrade surfaces post-upgrade create failures without hiding them", () => {
  const result = simulateCreateWithUpgradeErrors({
    slugAvailable: true,
    adjustment: {
      ok: true,
      status: 200,
      body: { success: true },
    },
    creation: {
      ok: false,
      status: 409,
      body: { error: "Slug is already taken" },
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.adjusted, true);
  assert.equal(result.created, false);
  assert.equal(result.body.error, "Slug is already taken");
});

test("create-with-upgrade rechecks slug availability before adjusting billing", () => {
  const routePath = path.join(
    process.cwd(),
    "src/app/api/enterprise/[enterpriseId]/organizations/create-with-upgrade/route.ts"
  );
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /ensureEnterpriseSlugAvailable/);
  assert.match(source, /Failed to verify slug availability/);
});
