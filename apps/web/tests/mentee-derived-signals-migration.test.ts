import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL(
    "../supabase/migrations/20261216000000_mentee_derived_signals.sql",
    import.meta.url
  ),
  "utf8"
);

test("adds derived signal columns to mentee_preferences idempotently", () => {
  assert.match(sql, /alter table public\.mentee_preferences/i);
  assert.match(sql, /add column if not exists derived_signals jsonb/i);
  assert.match(sql, /add column if not exists derived_signals_input_hash text/i);
});

test("adds cached why columns to mentorship_pairs", () => {
  assert.match(sql, /add column if not exists match_why text/i);
  assert.match(sql, /add column if not exists match_why_model text/i);
});

test("upsert RPC is SECURITY DEFINER and locked to service_role", () => {
  assert.match(sql, /create or replace function public\.upsert_mentee_derived_signals/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/i);
  assert.match(
    sql,
    /revoke all on function public\.upsert_mentee_derived_signals\([^)]*\) from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.upsert_mentee_derived_signals\([^)]*\) to service_role/i
  );
});

test("migration is transactional", () => {
  assert.match(sql, /^begin;/im);
  assert.match(sql, /commit;\s*$/i);
});
