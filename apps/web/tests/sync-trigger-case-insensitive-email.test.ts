import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

function getMigrationFiles(): string[] {
  return fs.readdirSync(migrationsDir).sort();
}

function getLatestSyncTriggerSql(): { file: string; sql: string } {
  const files = getMigrationFiles();
  // Body of CREATE OR REPLACE FUNCTION public.handle_org_member_sync()
  const pattern = /create or replace function public\.handle_org_member_sync\(\)[\s\S]*?\$\$;/i;
  let latest = { file: "", sql: "" };
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const match = sql.match(pattern);
    if (!match) continue;
    latest = { file, sql: match[0] };
  }
  return latest;
}

function countMatches(input: string, pattern: RegExp): number {
  return Array.from(input.matchAll(pattern)).length;
}

test("latest handle_org_member_sync uses case-insensitive email match in members, alumni, and parents", () => {
  const { sql } = getLatestSyncTriggerSql();
  assert.ok(sql.length > 0, "Expected to find handle_org_member_sync definition");

  // Allow optional table-alias prefix (e.g. `a.email`) so migrations that
  // refactor to aliased joins still pass.
  const lowerCount = countMatches(
    sql,
    /lower\((?:[a-z_]+\.)?email\)\s*=\s*lower\(v_user_email\)/g,
  );
  assert.ok(
    lowerCount >= 3,
    `Expected at least three lower(email) = lower(v_user_email) lookups (members, alumni, parents); got ${lowerCount}`,
  );
});

test("latest handle_org_member_sync no longer uses case-sensitive email = v_user_email", () => {
  const { sql } = getLatestSyncTriggerSql();

  // Negative lookbehind: count `email = v_user_email` only when NOT preceded by `lower(`
  const caseSensitive = countMatches(
    sql,
    /(?<!lower\()\bemail\s*=\s*v_user_email\b/g,
  );
  assert.equal(
    caseSensitive,
    0,
    "Expected zero case-sensitive email = v_user_email comparisons",
  );
});

test("members and alumni email lookups respect deleted_at IS NULL", () => {
  const { sql } = getLatestSyncTriggerSql();

  // Members lookup: capture from `from public.members` to the trailing `limit 1;`
  const membersBlock = sql.match(/from public\.members[\s\S]*?limit 1;/i);
  assert.ok(membersBlock, "Expected to find members SELECT block");
  assert.match(
    membersBlock![0],
    /lower\(email\)\s*=\s*lower\(v_user_email\)/i,
    "Members lookup should use lower() comparison",
  );
  assert.match(
    membersBlock![0],
    /deleted_at\s+is\s+null/i,
    "Members email lookup should respect deleted_at IS NULL",
  );

  // Alumni lookup (may use aliased table-name like `public.alumni a`)
  const alumniBlock = sql.match(/from public\.alumni\b[\s\S]*?limit 1;/i);
  assert.ok(alumniBlock, "Expected to find alumni SELECT block");
  assert.match(
    alumniBlock![0],
    /lower\((?:[a-z_]+\.)?email\)\s*=\s*lower\(v_user_email\)/i,
    "Alumni lookup should use lower() comparison",
  );
  assert.match(
    alumniBlock![0],
    /deleted_at\s+is\s+null/i,
    "Alumni email lookup should respect deleted_at IS NULL",
  );
});

test("parents branch behavior preserved (case-insensitive + deleted_at IS NULL)", () => {
  const { sql } = getLatestSyncTriggerSql();

  // Parents lookup region
  const parentsBlock = sql.match(/from public\.parents[\s\S]*?limit 1;/i);
  assert.ok(parentsBlock, "Expected to find parents SELECT block");
  assert.match(
    parentsBlock![0],
    /lower\(email\)\s*=\s*lower\(v_user_email\)/i,
    "Parents lookup should remain case-insensitive",
  );
  assert.match(
    parentsBlock![0],
    /deleted_at\s+is\s+null/i,
    "Parents lookup should retain deleted_at IS NULL filter",
  );
});

test("one-time alumni reconciliation backfill exists in the case-insensitive sync-trigger migration", () => {
  // This backfill is a historical one-time reconciliation that lives in
  // 20261103000000_sync_trigger_case_insensitive_email.sql. Later migrations
  // that recreate handle_org_member_sync do not need to re-run it.
  const backfillFile = "20261103000000_sync_trigger_case_insensitive_email.sql";
  const full = fs.readFileSync(path.join(migrationsDir, backfillFile), "utf8");

  assert.match(
    full,
    /update\s+public\.alumni[\s\S]*?from\s+public\.members[\s\S]*?lower\(\s*a\.email\s*\)\s*=\s*lower\(\s*m\.email\s*\)/i,
    "Expected reconciliation UPDATE joining alumni to members on lower(email)",
  );
  assert.match(
    full,
    /update\s+public\.alumni[\s\S]*?a\.user_id\s+is\s+null/i,
    "Reconciliation must filter to a.user_id IS NULL for idempotency",
  );
  assert.match(
    full,
    /update\s+public\.alumni[\s\S]*?a\.deleted_at\s+is\s+null/i,
    "Reconciliation must filter alumni.deleted_at IS NULL",
  );
  assert.match(
    full,
    /update\s+public\.alumni[\s\S]*?m\.deleted_at\s+is\s+null/i,
    "Reconciliation must filter members.deleted_at IS NULL",
  );
});
