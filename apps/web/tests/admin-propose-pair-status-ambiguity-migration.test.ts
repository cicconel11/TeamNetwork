import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL(
    "../supabase/migrations/20261217000000_fix_admin_propose_pair_status_ambiguity.sql",
    import.meta.url
  ),
  "utf8"
);

test("redefines admin_propose_pair with the variable_conflict directive", () => {
  assert.match(sql, /create or replace function public\.admin_propose_pair/i);
  // The fix: bare `status` must resolve to the table column, not the OUT param.
  assert.match(sql, /#variable_conflict use_column/);
});

test("preserves the function signature and security settings", () => {
  assert.match(sql, /returns table \(pair_id uuid, status text, match_score numeric, match_signals jsonb, reused boolean\)/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path to 'public'/i);
});
