import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260714000000_member_identity_hardening.sql", import.meta.url),
  "utf8",
);

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("member identity migration teaches handle_org_member_sync to fall back to auth name metadata", () => {
  const normalized = squishWhitespace(migration);

  assert.match(migration, /raw_user_meta_data->>'name'/);
  assert.ok(
    normalized.includes("v_full_name := COALESCE(v_full_name, v_display_name);"),
    "trigger should fall back from full_name to name before using the Member placeholder"
  );
  assert.ok(
    normalized.includes("v_first_name := COALESCE(v_first_name, 'Member');"),
    "trigger must preserve the final placeholder fallback only after exhausting metadata-derived names"
  );
});

test("member identity migration backfills only placeholder or blank linked member names", () => {
  const normalized = squishWhitespace(migration);

  assert.ok(
    normalized.includes("UPDATE public.members AS m SET first_name = split_part(btrim(u.name), ' ', 1)"),
    "migration should backfill first_name from public.users.name"
  );
  assert.ok(
    normalized.includes("FROM public.users AS u WHERE m.user_id = u.id"),
    "migration should backfill from public.users for linked members"
  );
  assert.ok(
    normalized.includes("m.user_id IS NOT NULL"),
    "migration should only repair linked member rows"
  );
  assert.ok(
    normalized.includes("(COALESCE(btrim(m.first_name), '') = '' AND COALESCE(btrim(m.last_name), '') = '') OR (COALESCE(btrim(m.first_name), '') = 'Member' AND COALESCE(btrim(m.last_name), '') = '')"),
    "migration should only repair placeholder or blank names"
  );
  assert.ok(
    normalized.includes("position('@' in btrim(u.name)) = 0"),
    "migration should skip public.users.name values that are email-like"
  );
});

test("member identity migration repairs placeholder names when linking an existing members row", () => {
  const normalized = squishWhitespace(migration);

  assert.ok(
    normalized.includes("UPDATE public.members SET user_id = NEW.user_id, first_name = CASE"),
    "existing linked member rows should repair placeholder names during trigger updates"
  );
  assert.ok(
    normalized.includes("COALESCE(btrim(first_name), '') = 'Member' AND COALESCE(btrim(last_name), '') = ''"),
    "trigger repair should target the Member placeholder shape"
  );
});
