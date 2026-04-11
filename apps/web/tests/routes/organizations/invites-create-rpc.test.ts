import test from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Regression test for the create_org_invite RPC failure:
//   "function gen_random_bytes(integer) does not exist"
//
// Root cause: 20260811000000_fix_function_search_path_mutable.sql recreated
// public.create_org_invite with `SET search_path = ''` but left bare
// gen_random_bytes(...) calls in the body. With an empty search_path the
// unqualified name doesn't resolve (pgcrypto lives in `extensions`), so the
// invite UI hard-fails with the error above.
//
// The fix lives in a later migration that schema-qualifies both call sites
// as public.gen_random_bytes(...). This test asserts that the most recent
// migration touching create_org_invite contains the qualified form and does
// NOT contain a bare gen_random_bytes call inside the function body, so we
// can't silently regress by adding another search_path-empty redefinition.

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function findLatestCreateOrgInviteMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let latest: string | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    if (/CREATE OR REPLACE FUNCTION\s+public\.create_org_invite\s*\(/i.test(sql)) {
      latest = file;
    }
  }
  if (!latest) {
    throw new Error("No migration defines public.create_org_invite");
  }
  return latest;
}

test("latest create_org_invite migration schema-qualifies gen_random_bytes", () => {
  const file = findLatestCreateOrgInviteMigration();
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

  // Must contain the qualified form for both call sites (6 and 24 byte calls).
  assert.match(
    sql,
    /public\.gen_random_bytes\s*\(\s*6\s*\)/,
    `${file}: missing public.gen_random_bytes(6) — bare call would fail under SET search_path = ''`,
  );
  assert.match(
    sql,
    /public\.gen_random_bytes\s*\(\s*24\s*\)/,
    `${file}: missing public.gen_random_bytes(24) — bare call would fail under SET search_path = ''`,
  );

  // And must NOT contain an unqualified call (the regressed pattern).
  // Strip SQL line comments and qualified occurrences first so the negative
  // match only fires on real call sites.
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/public\.gen_random_bytes/g, "QUALIFIED");
  assert.doesNotMatch(
    stripped,
    /\bgen_random_bytes\s*\(/,
    `${file}: contains a bare gen_random_bytes(...) call — must be schema-qualified as public.gen_random_bytes`,
  );
});

test("latest create_org_invite migration stays after require_approval and preserves standard invite roles", () => {
  const file = findLatestCreateOrgInviteMigration();
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

  assert.ok(
    file > "20260803100000_per_invite_require_approval.sql",
    `${file}: must sort after 20260803100000_per_invite_require_approval.sql so the latest create_org_invite definition keeps the 5-arg require_approval shape`
  );
  assert.match(
    sql,
    /p_require_approval\s+boolean\s+DEFAULT\s+NULL/i,
    `${file}: latest create_org_invite migration must retain the require_approval parameter`
  );
  assert.match(
    sql,
    /p_role\s+NOT\s+IN\s*\(\s*'admin'\s*,\s*'active_member'\s*,\s*'alumni'/i,
    `${file}: latest create_org_invite validation must still allow admin, active_member, and alumni invites`
  );
});
