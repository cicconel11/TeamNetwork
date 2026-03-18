import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260708000000_linkedin_enrichment_timestamp.sql",
);

const migrationSource = fs.readFileSync(migrationPath, "utf8");

test("linkedin enrichment timestamp migration does NOT backfill using updated_at", () => {
  assert.doesNotMatch(
    migrationSource,
    /SET[\s\S]*last_enriched_at\s*=\s*updated_at/i,
    "Migration must not backfill last_enriched_at from updated_at (unreliable proxy)",
  );
});

test("linkedin enrichment timestamp migration still stamps new enrichments with now", () => {
  assert.match(migrationSource, /last_enriched_at\s*=\s*now\(\)/i);
});
