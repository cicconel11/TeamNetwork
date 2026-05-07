import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/cron/linkedin-bulk-sync/route.ts"),
  "utf8",
);

test("linkedin bulk sync cron does not soft-delete filter organizations", () => {
  const organizationsQuery = routeSource.match(
    /\.from\("organizations"\)[\s\S]*?\.eq\("linkedin_resync_enabled", true\)[\s\S]*?;/,
  );

  assert.ok(organizationsQuery, "expected organizations query in linkedin bulk sync cron");
  assert.doesNotMatch(
    organizationsQuery[0],
    /\.is\("deleted_at", null\)/,
    "organizations has no deleted_at column; filtering it will make the cron fail at runtime",
  );
});

test("enterprise migrations document that organizations has no deleted_at column", () => {
  const countsSql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261020200002_enterprise_counts_function.sql"),
    "utf8",
  );
  const batchSql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261020200001_batch_create_enterprise_orgs.sql"),
    "utf8",
  );

  assert.match(countsSql, /organizations table has no deleted_at column/i);
  assert.match(batchSql, /organizations table has no deleted_at column/i);
});
