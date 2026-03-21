import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("sync log unique index migration cleans duplicate running rows before adding the index", () => {
  const migrationPath = new URL(
    "../supabase/migrations/20260710000001_sync_log_running_unique_index.sql",
    import.meta.url,
  );
  const sql = fs.readFileSync(migrationPath, "utf8");

  const cleanupMatch = sql.match(
    /update\s+(?:public\.)?integration_sync_log(?:\s+as\s+\w+)?[\s\S]+?set[\s\S]+?status\s*=\s*'failed'/i,
  );
  const createIndexMatch = sql.match(/create\s+unique\s+index/i);

  assert.ok(
    cleanupMatch,
    "migration must mark pre-existing duplicate running rows as failed before creating the unique index",
  );
  assert.ok(createIndexMatch, "migration must still create the unique index");
  assert.ok(
    cleanupMatch.index! < createIndexMatch.index!,
    "duplicate-row cleanup must run before CREATE UNIQUE INDEX",
  );
});
