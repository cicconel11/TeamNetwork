import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveCurrentQuantity } from "@/lib/enterprise/quota-logic";
import { getSubOrgPricing, getFreeSubOrgCount } from "@/lib/enterprise/pricing";

interface SimulationParams {
  rawQuantity: number | null;
  currentManagedOrgCount: number;
  bucketQuantity: number;
  billingInterval: "month" | "year";
  confirmUpgrade?: boolean;
}

interface AdjustmentInvocation {
  newQuantity: number;
  expectedCurrentQuantity?: number;
}

/**
 * Mirrors the route's hard-block branch: if confirmUpgrade !== true, return
 * 402 needsUpgrade with cost preview and never invoke the seat adjuster.
 */
function simulateHardBlock(params: SimulationParams) {
  const currentQuantity = resolveCurrentQuantity(
    params.rawQuantity,
    params.currentManagedOrgCount,
    getFreeSubOrgCount(params.bucketQuantity)
  );
  const requestedQuantity = currentQuantity + 1;

  let adjustmentCalledWith: AdjustmentInvocation | null = null;

  if (params.confirmUpgrade !== true) {
    const currentPricing = getSubOrgPricing(
      currentQuantity,
      params.billingInterval,
      params.bucketQuantity
    );
    const projectedPricing = getSubOrgPricing(
      requestedQuantity,
      params.billingInterval,
      params.bucketQuantity
    );

    return {
      status: 402,
      body: {
        error: "Upgrade confirmation required to add another organization",
        needsUpgrade: true,
        currentCount: params.currentManagedOrgCount,
        maxAllowed: params.rawQuantity,
        currentQuantity,
        requestedQuantity,
        billingInterval: params.billingInterval,
        costPreview: {
          current: {
            freeOrgs: currentPricing.freeOrgs,
            billableOrgs: currentPricing.billableOrgs,
            totalCents: currentPricing.totalCents,
          },
          projected: {
            freeOrgs: projectedPricing.freeOrgs,
            billableOrgs: projectedPricing.billableOrgs,
            totalCents: projectedPricing.totalCents,
          },
          additionalCents: projectedPricing.totalCents - currentPricing.totalCents,
          unitCents: projectedPricing.unitCents,
        },
      },
      adjustmentCalledWith,
    };
  }

  // Confirmed path: invoke seat adjuster.
  adjustmentCalledWith = {
    newQuantity: requestedQuantity,
    expectedCurrentQuantity: params.rawQuantity ?? undefined,
  };

  return {
    status: 201,
    body: { ok: true },
    adjustmentCalledWith,
  };
}

test("create-with-upgrade returns 402 needsUpgrade when confirmUpgrade is omitted", () => {
  const result = simulateHardBlock({
    rawQuantity: 4,
    currentManagedOrgCount: 4,
    bucketQuantity: 1,
    billingInterval: "month",
  });

  assert.equal(result.status, 402);
  assert.equal(result.body.needsUpgrade, true);
  assert.equal(result.adjustmentCalledWith, null, "must not bump seat quantity without explicit confirmation");
  assert.equal(result.body.currentQuantity, 4);
  assert.equal(result.body.requestedQuantity, 5);
  // Cost preview present so frontend can render confirm modal.
  assert.ok(result.body.costPreview, "402 must include costPreview");
});

test("create-with-upgrade returns 402 when confirmUpgrade is explicitly false", () => {
  const result = simulateHardBlock({
    rawQuantity: 3,
    currentManagedOrgCount: 3,
    bucketQuantity: 1,
    billingInterval: "month",
    confirmUpgrade: false,
  });

  assert.equal(result.status, 402);
  assert.equal(result.adjustmentCalledWith, null);
});

test("create-with-upgrade proceeds when confirmUpgrade is true", () => {
  const result = simulateHardBlock({
    rawQuantity: 4,
    currentManagedOrgCount: 4,
    bucketQuantity: 1,
    billingInterval: "month",
    confirmUpgrade: true,
  });

  assert.equal(result.status, 201);
  assert.deepEqual(result.adjustmentCalledWith, {
    newQuantity: 5,
    expectedCurrentQuantity: 4,
  });
});

test("create-with-upgrade cost preview reports non-zero additional charge when crossing free tier", () => {
  // Bucket=1 → freeSubOrgs=3. Going from 3 → 4 orgs adds first billable org.
  const result = simulateHardBlock({
    rawQuantity: 3,
    currentManagedOrgCount: 3,
    bucketQuantity: 1,
    billingInterval: "month",
  });

  assert.equal(result.status, 402);
  const preview = result.body.costPreview as {
    current: { billableOrgs: number; totalCents: number };
    projected: { billableOrgs: number; totalCents: number };
    additionalCents: number;
  };
  assert.equal(preview.current.billableOrgs, 0);
  assert.equal(preview.projected.billableOrgs, 1);
  assert.ok(preview.additionalCents > 0, "crossing free tier must report a positive additionalCents");
});

test("create-with-upgrade route source enforces confirmUpgrade hard block", () => {
  const routePath = path.join(
    process.cwd(),
    "src/app/api/enterprise/[enterpriseId]/organizations/create-with-upgrade/route.ts"
  );
  const source = readFileSync(routePath, "utf8");

  // Schema must accept the optional flag.
  assert.match(source, /confirmUpgrade:\s*z\.boolean\(\)\.optional\(\)/);
  // Route must short-circuit when the flag is missing.
  assert.match(source, /confirmUpgrade\s*!==\s*true/);
  // Hard-block response must be 402 with needsUpgrade payload (matches batch-create convention).
  assert.match(source, /needsUpgrade:\s*true/);
  assert.match(source, /402/);
  // Cost preview must be returned so the frontend can render a confirm modal.
  assert.match(source, /costPreview/);
});

test("create-with-upgrade frontend caller passes confirmUpgrade: true after modal confirm", () => {
  const formPath = path.join(
    process.cwd(),
    "src/components/enterprise/CreateSubOrgForm.tsx"
  );
  const source = readFileSync(formPath, "utf8");

  // The retry path (handleUpgradeConfirm) must include confirmUpgrade: true.
  assert.match(source, /confirmUpgrade:\s*true/);
});
