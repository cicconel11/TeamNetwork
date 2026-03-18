import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  import.meta.dirname,
  "..",
  "supabase",
  "migrations",
  "20260711000000_backfill_last_enriched_url.sql",
);

const migrationSource = fs.readFileSync(migrationPath, "utf8");

test("backfill migration updates rows with last_enriched_at but no last_enriched_url", () => {
  assert.match(
    migrationSource,
    /UPDATE\s+public\.user_linkedin_connections/i,
    "expected UPDATE on user_linkedin_connections",
  );
  assert.match(
    migrationSource,
    /last_enriched_at\s+IS\s+NOT\s+NULL/i,
    "expected filter for rows that have been enriched",
  );
  assert.match(
    migrationSource,
    /last_enriched_url\s+IS\s+NULL/i,
    "expected filter for rows missing last_enriched_url",
  );
});

test("backfill uses COALESCE with linkedin_profile_url as first choice", () => {
  assert.match(
    migrationSource,
    /COALESCE\s*\(/i,
    "expected COALESCE for multi-source fallback",
  );
  assert.match(
    migrationSource,
    /c\.linkedin_profile_url/i,
    "expected linkedin_profile_url as primary source",
  );
});

test("backfill falls back to members, alumni, and parents linkedin_url", () => {
  assert.match(
    migrationSource,
    /FROM\s+public\.members\s+m/i,
    "expected members table as fallback source",
  );
  assert.match(
    migrationSource,
    /FROM\s+public\.alumni\s+a/i,
    "expected alumni table as fallback source",
  );
  assert.match(
    migrationSource,
    /FROM\s+public\.parents\s+p/i,
    "expected parents table as fallback source",
  );
});

test("backfill respects soft-delete on fallback tables", () => {
  // Each subquery should filter out soft-deleted rows
  const memberSubquery = migrationSource.match(/members[\s\S]*?LIMIT\s+1/i)?.[0] ?? "";
  assert.match(memberSubquery, /deleted_at\s+IS\s+NULL/i, "members subquery should filter deleted_at");

  const alumniSubquery = migrationSource.match(/alumni[\s\S]*?LIMIT\s+1/i)?.[0] ?? "";
  assert.match(alumniSubquery, /deleted_at\s+IS\s+NULL/i, "alumni subquery should filter deleted_at");

  const parentsSubquery = migrationSource.match(/parents[\s\S]*?LIMIT\s+1/i)?.[0] ?? "";
  assert.match(parentsSubquery, /deleted_at\s+IS\s+NULL/i, "parents subquery should filter deleted_at");
});
