import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  import.meta.dirname,
  "..",
  "supabase",
  "migrations",
  "20260709000000_linkedin_enrichment_upsert.sql",
);

const migrationSource = fs.readFileSync(migrationPath, "utf8");

test("migration contains IF NOT FOUND + INSERT pattern for sentinel row", () => {
  assert.match(
    migrationSource,
    /IF v_conn_updated = 0 THEN/,
    "expected the RPC to check if the UPDATE matched any rows",
  );
  assert.match(
    migrationSource,
    /INSERT INTO public\.user_linkedin_connections/,
    "expected a fallback INSERT for manual-URL users with no connection row",
  );
});

test("migration uses enriched_only status for sentinel rows", () => {
  assert.match(
    migrationSource,
    /'enriched_only'/,
    "expected the sentinel row to use 'enriched_only' status",
  );
  // Also verify the CHECK constraint is expanded
  assert.match(
    migrationSource,
    /CHECK.*enriched_only/,
    "expected the status CHECK constraint to be expanded to include 'enriched_only'",
  );
});

test("migration uses manual:: sentinel sub to satisfy unique constraint", () => {
  assert.match(
    migrationSource,
    /'manual::'\s*\|\|\s*p_user_id/,
    "expected sentinel linkedin_sub to use 'manual::' || p_user_id pattern",
  );
});

test("migration sets last_enriched_at on both UPDATE and INSERT paths", () => {
  const updateMatch = migrationSource.match(/UPDATE public\.user_linkedin_connections[\s\S]*?WHERE user_id = p_user_id/);
  assert.ok(updateMatch, "expected UPDATE on user_linkedin_connections");
  assert.match(
    updateMatch![0],
    /last_enriched_at\s*=\s*now\(\)/,
    "expected UPDATE path to set last_enriched_at = now()",
  );

  const insertMatch = migrationSource.match(/INSERT INTO public\.user_linkedin_connections[\s\S]*?\)/);
  assert.ok(insertMatch, "expected INSERT into user_linkedin_connections");
  assert.match(
    insertMatch![0],
    /last_enriched_at/,
    "expected INSERT path to include last_enriched_at",
  );
});
