import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260203000000_create_error_tracking_tables.sql"
);

async function loadMigrationSql(): Promise<string> {
  return readFile(migrationPath, "utf-8");
}

test("error_groups uniqueness is scoped to env + fingerprint", async () => {
  const sql = await loadMigrationSql();

  assert.match(
    sql,
    /CONSTRAINT\s+error_groups_env_fingerprint_key\s+UNIQUE\s*\(\s*env\s*,\s*fingerprint\s*\)/i
  );
  assert.doesNotMatch(sql, /\bfingerprint\s+text\s+UNIQUE\b/i);
});

test("upsert_error_group conflict target uses env + fingerprint", async () => {
  const sql = await loadMigrationSql();

  assert.match(sql, /ON\s+CONFLICT\s*\(\s*env\s*,\s*fingerprint\s*\)\s+DO\s+UPDATE/i);
  assert.doesNotMatch(sql, /ON\s+CONFLICT\s*\(\s*fingerprint\s*\)\s+DO\s+UPDATE/i);
});
