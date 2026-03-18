import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(
  import.meta.dirname,
  "..",
  "supabase",
  "migrations",
  "20260710000000_linkedin_enriched_url_column.sql",
);

const migrationSource = fs.readFileSync(migrationPath, "utf8");

test("migration adds last_enriched_url column", () => {
  assert.match(
    migrationSource,
    /ADD COLUMN IF NOT EXISTS last_enriched_url text/i,
    "expected ALTER TABLE to add last_enriched_url column",
  );
});

test("RPC signature includes p_enriched_url parameter", () => {
  assert.match(
    migrationSource,
    /p_enriched_url\s+text\s+DEFAULT\s+NULL/,
    "expected p_enriched_url text DEFAULT NULL parameter in RPC",
  );
});

test("UPDATE branch sets last_enriched_url", () => {
  // The UPDATE inside the enrichment block should set last_enriched_url
  const updateBlock = migrationSource.slice(
    migrationSource.indexOf("UPDATE public.user_linkedin_connections"),
    migrationSource.indexOf("GET DIAGNOSTICS v_conn_updated"),
  );
  assert.match(
    updateBlock,
    /last_enriched_url\s*=\s*p_enriched_url/,
    "expected UPDATE to set last_enriched_url = p_enriched_url",
  );
});

test("INSERT branch includes last_enriched_url", () => {
  const insertBlock = migrationSource.slice(
    migrationSource.indexOf("INSERT INTO public.user_linkedin_connections"),
  );
  assert.match(
    insertBlock,
    /last_enriched_url/,
    "expected INSERT to include last_enriched_url column",
  );
  assert.match(
    insertBlock,
    /p_enriched_url/,
    "expected INSERT values to include p_enriched_url",
  );
});

test("GRANT covers the new 9-param signature", () => {
  // Should have 9 type names in the GRANT
  assert.match(
    migrationSource,
    /GRANT EXECUTE ON FUNCTION.*uuid,\s*text,\s*text,\s*text,\s*text,\s*text,\s*text,\s*jsonb,\s*text\)/,
    "expected GRANT for 9-param signature (uuid + 7 text + jsonb + text)",
  );
});
