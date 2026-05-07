import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cronRouteSource = readFileSync(
  join(process.cwd(), "src/app/api/cron/account-deletion/route.ts"),
  "utf8",
);
const originalDeletionMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260131100000_user_deletion_requests.sql"),
  "utf8",
);
const regressionFixMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261012130000_fix_compliance_regressions.sql"),
  "utf8",
);

describe("account deletion cron regression coverage", () => {
  it("preserves deletion requests after auth user deletion", () => {
    assert.match(
      originalDeletionMigration,
      /REFERENCES auth\.users\(id\) ON DELETE CASCADE/,
    );
    assert.match(
      regressionFixMigration,
      /DROP CONSTRAINT IF EXISTS user_deletion_requests_user_id_fkey;/,
    );
  });

  it("adds completed_at so the cron can leave an auditable completion timestamp", () => {
    assert.match(
      regressionFixMigration,
      /ADD COLUMN IF NOT EXISTS completed_at timestamptz;/i,
    );
    assert.match(cronRouteSource, /completed_at:\s*new Date\(\)\.toISOString\(\)/);
  });

  it("keeps the deletion call ahead of the completion update", () => {
    const deleteIndex = cronRouteSource.indexOf("deleteUser(req.user_id)");
    const updateIndex = cronRouteSource.indexOf('status: "completed"');

    assert.ok(deleteIndex >= 0, "deleteUser call should exist");
    assert.ok(updateIndex >= 0, "completion update should exist");
    assert.ok(
      deleteIndex < updateIndex,
      "request should only be marked completed after deleteUser finishes",
    );
  });

  it("still treats already-deleted users as completeable work", () => {
    assert.match(cronRouteSource, /deleteError\.message\?\.includes\("not found"\)/);
    assert.match(cronRouteSource, /status:\s*"completed"/);
  });
});
