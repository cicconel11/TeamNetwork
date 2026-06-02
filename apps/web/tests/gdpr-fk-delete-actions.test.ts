import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261212000000_fix_fk_delete_actions_gdpr.sql", import.meta.url),
  "utf8",
);

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("GDPR FK repair cascades members rows on auth user deletion", () => {
  const normalized = squishWhitespace(migration);
  const membersStatement = normalized.match(
    /ALTER TABLE public\.members\s+DROP CONSTRAINT IF EXISTS members_user_id_fkey,\s+ADD CONSTRAINT members_user_id_fkey\s+FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE (?:CASCADE|SET NULL);/,
  )?.[0] ?? "";

  assert.match(
    membersStatement,
    /ON DELETE CASCADE;/,
    "members rows contain directly-identifying profile data and must be deleted with the auth user",
  );
  assert.doesNotMatch(
    membersStatement,
    /ON DELETE SET NULL;/,
    "members_user_id_fkey must not preserve orphaned PII rows",
  );
});
