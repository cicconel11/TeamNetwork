import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extractEnterpriseOrgLimitInfo,
  isEnterpriseOrgLimitRpcError,
} from "@/lib/enterprise/org-limit-errors";

interface UpgradeInfo {
  currentCount: number;
  maxAllowed: number | null;
  remaining: number | null;
}

function simulateBatchCreateUpgradeResponse(
  rpcError: { code?: string; message?: string },
  quotaInfo?: UpgradeInfo
) {
  if (!isEnterpriseOrgLimitRpcError(rpcError)) {
    return { status: 500, body: { error: "Failed to create organizations" } };
  }

  const upgradeInfo = quotaInfo ?? extractEnterpriseOrgLimitInfo(rpcError.message);

  return {
    status: 402,
    body: {
      error: "Organization limit exceeded",
      needsUpgrade: true,
      currentCount: upgradeInfo?.currentCount ?? null,
      maxAllowed: upgradeInfo?.maxAllowed ?? null,
      remaining: upgradeInfo?.remaining ?? null,
    },
  };
}

test("batch create maps 23514 org-cap RPC failures to needsUpgrade", () => {
  const rpcError = {
    code: "23514",
    message: "Batch would exceed org limit: 4 existing + 2 new > 4 allowed",
  };

  const response = simulateBatchCreateUpgradeResponse(rpcError, {
    currentCount: 4,
    maxAllowed: 4,
    remaining: 0,
  });

  assert.equal(response.status, 402);
  assert.equal(response.body.needsUpgrade, true);
  assert.equal(response.body.currentCount, 4);
  assert.equal(response.body.maxAllowed, 4);
  assert.equal(response.body.remaining, 0);
});

test("batch create can fall back to parsing org-cap counts from the RPC message", () => {
  const rpcError = {
    code: "23514",
    message: "Batch would exceed org limit: 7 existing + 3 new > 8 allowed",
  };

  assert.equal(isEnterpriseOrgLimitRpcError(rpcError), true);
  assert.deepEqual(extractEnterpriseOrgLimitInfo(rpcError.message), {
    currentCount: 7,
    maxAllowed: 8,
    remaining: 1,
  });

  const response = simulateBatchCreateUpgradeResponse(rpcError);

  assert.equal(response.status, 402);
  assert.equal(response.body.currentCount, 7);
  assert.equal(response.body.maxAllowed, 8);
  assert.equal(response.body.remaining, 1);
});

test("batch create migration preflights requested slugs against organizations and enterprises", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20261020200001_batch_create_enterprise_orgs.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /SELECT array_agg\(trim\(COALESCE\(value->>'slug', ''\)\)\)/);
  assert.match(sql, /FROM public\.organizations o[\s\S]*?WHERE o\.slug = ANY/);
  assert.match(sql, /FROM public\.enterprises e[\s\S]*?WHERE e\.slug = ANY/);
  assert.match(sql, /RAISE EXCEPTION 'Slug "%" is already taken', v_conflicting_slug/);
});

test("batch create slug-conflict preflight runs before the insert loop", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20261020200001_batch_create_enterprise_orgs.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");
  const preflightIndex = sql.indexOf("SELECT conflict.slug");
  const loopIndex = sql.indexOf("FOR v_row IN");

  assert.notEqual(preflightIndex, -1);
  assert.notEqual(loopIndex, -1);
  assert.equal(preflightIndex < loopIndex, true);
});
