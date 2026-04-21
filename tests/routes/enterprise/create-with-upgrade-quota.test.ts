import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveCurrentQuantity } from "@/lib/enterprise/quota-logic";

interface AdjustmentOutcome {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

interface CreateOutcome {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

function simulateCreateWithUpgrade(params: {
  rawQuantity: number | null;
  currentManagedOrgCount: number;
  freeBaseline: number;
  expectedCurrentQuantity?: number;
  adjustment: AdjustmentOutcome;
  creation: CreateOutcome;
}) {
  const currentQuantity = resolveCurrentQuantity(
    params.rawQuantity,
    params.currentManagedOrgCount,
    params.freeBaseline
  );

  const adjustmentRequest = {
    newQuantity: currentQuantity + 1,
    expectedCurrentQuantity: params.expectedCurrentQuantity,
  };

  if (!params.adjustment.ok) {
    return {
      status: params.adjustment.status,
      body: params.adjustment.body,
      adjustmentRequest,
      createCalled: false,
    };
  }

  if (!params.creation.ok) {
    return {
      status: params.creation.status,
      body: params.creation.body,
      adjustmentRequest,
      createCalled: true,
    };
  }

  return {
    status: 201,
    body: params.creation.body,
    adjustmentRequest,
    createCalled: true,
  };
}

test("create-with-upgrade increments quantity before creating the org", () => {
  const result = simulateCreateWithUpgrade({
    rawQuantity: 4,
    currentManagedOrgCount: 4,
    freeBaseline: 3,
    expectedCurrentQuantity: 4,
    adjustment: {
      ok: true,
      status: 200,
      body: {
        success: true,
        subscription: { quantity: 5 },
      },
    },
    creation: {
      ok: true,
      status: 201,
      body: { organization: { id: "org-1", slug: "new-org" } },
    },
  });

  assert.equal(result.status, 201);
  assert.deepEqual(result.adjustmentRequest, {
    newQuantity: 5,
    expectedCurrentQuantity: 4,
  });
  assert.equal(result.createCalled, true);
  assert.deepEqual(result.body, {
    organization: { id: "org-1", slug: "new-org" },
  });
});

test("create-with-upgrade returns 409 on stale expectedCurrentQuantity and creates nothing", () => {
  const result = simulateCreateWithUpgrade({
    rawQuantity: 4,
    currentManagedOrgCount: 4,
    freeBaseline: 3,
    expectedCurrentQuantity: 4,
    adjustment: {
      ok: false,
      status: 409,
      body: {
        error: "Seat quantity changed. Please refresh and try again.",
        currentQuantity: 5,
      },
    },
    creation: {
      ok: true,
      status: 201,
      body: { organization: { id: "org-ignored" } },
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.createCalled, false);
  assert.equal(result.body.error, "Seat quantity changed. Please refresh and try again.");
});

test("create-with-upgrade route uses resolveCurrentQuantity and the shared billing adjust helper", () => {
  const routePath = path.join(
    process.cwd(),
    "src/app/api/enterprise/[enterpriseId]/organizations/create-with-upgrade/route.ts"
  );
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /resolveCurrentQuantity\(/);
  assert.match(source, /adjustEnterpriseSubOrgQuantity\(/);
  assert.match(source, /newQuantity:\s*currentQuantity\s*\+\s*1/);
});
