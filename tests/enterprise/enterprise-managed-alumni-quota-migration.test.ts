import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationFile = "../../supabase/migrations/20261014000000_fix_enterprise_managed_alumni_quota.sql";
const migration = readFileSync(new URL(migrationFile, import.meta.url), "utf8");

test("enterprise-managed alumni quota migration uses pooled enterprise limit", () => {
  assert.match(
    migration,
    /IF v_status = 'enterprise_managed' AND v_enterprise_id IS NOT NULL THEN/
  );
  assert.match(
    migration,
    /FROM public\.enterprise_subscriptions es[\s\S]*?COALESCE\(es\.alumni_bucket_quantity, 0\) \* 2500/
  );
  assert.match(
    migration,
    /FROM public\.alumni a[\s\S]*?INNER JOIN public\.organizations o[\s\S]*?WHERE o\.enterprise_id = v_enterprise_id/
  );
});

test("enterprise-managed alumni quota migration preserves org-scoped fallback", () => {
  assert.match(migration, /v_limit := public\.alumni_bucket_limit\(v_bucket\);/);
  assert.match(
    migration,
    /FROM public\.alumni[\s\S]*?WHERE organization_id = p_org_id[\s\S]*?AND deleted_at IS NULL;/
  );
});

test("enterprise-managed alumni quota migration keeps security-definer hardening", () => {
  assert.equal(
    (migration.match(/SET search_path = ''/g) ?? []).length >= 3,
    true
  );
});
