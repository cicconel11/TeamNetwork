import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// R4: a transient Blackbaud sub-resource failure can null alumni.email for a
// page even after the writer-side fix lands (defense in depth). The claim RPC
// + handle_org_member_sync trigger must therefore fall back to the last
// successfully imported email snapshot in alumni_external_ids.external_data.
//
// The repo has no live-DB integration harness for plpgsql, so this test
// asserts the migration wiring at the SQL source level — mirrors the pattern
// in claim-flow-grants-from-alumni.test.ts.

const migrationPath = path.join(
  process.cwd(),
  "..",
  "..",
  "supabase",
  "migrations",
  "20261208000000_claim_uses_external_data_email_fallback.sql",
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, "utf8");
}

test("migration exists at the expected path", () => {
  assert.ok(fs.existsSync(migrationPath), "fallback migration file must exist");
});

test("claim_alumni_profiles still preserves primary alumni.email match", () => {
  const src = readMigration();
  // Match still requires lower(a.email) = lower(v_email) when a.email is set —
  // primary path is unchanged in shape.
  assert.match(
    src,
    /a\.email IS NOT NULL\s+AND lower\(a\.email\)\s*=\s*lower\(v_email\)/,
    "primary alumni.email match must remain in claim_alumni_profiles",
  );
});

test("claim_alumni_profiles LEFT JOINs alumni_external_ids for fallback", () => {
  const src = readMigration();
  assert.match(
    src,
    /LEFT JOIN public\.alumni_external_ids aei ON aei\.alumni_id = a\.id/,
    "claim RPC must LEFT JOIN alumni_external_ids",
  );
});

test("claim_alumni_profiles fallback fires only when alumni.email IS NULL", () => {
  const src = readMigration();
  // The fallback arm must gate on a.email IS NULL so a populated alumni.email
  // that diverges from the snapshot does not surprise-match.
  assert.match(
    src,
    /a\.email IS NULL[\s\S]*?aei\.external_data->>'email'[\s\S]*?lower\(aei\.external_data->>'email'\)\s*=\s*lower\(v_email\)/,
    "fallback arm must require a.email IS NULL and match external_data->>'email'",
  );
});

test("claim_alumni_profiles fallback compares case-insensitively", () => {
  const src = readMigration();
  assert.match(
    src,
    /lower\(aei\.external_data->>'email'\)\s*=\s*lower\(v_email\)/,
    "fallback must match case-insensitively (auth.users.email is normalized lowercase)",
  );
});

test("handle_org_member_sync alumni arm gains the external_data fallback", () => {
  const src = readMigration();
  // Trigger fires after the UOR insert; alumni email-keyed lookup must also
  // fall back to the snapshot so alumni.user_id gets set.
  const triggerSection = src.split("CREATE OR REPLACE FUNCTION public.handle_org_member_sync")[1] ?? "";
  assert.ok(triggerSection.length > 0, "handle_org_member_sync recreated");
  assert.match(
    triggerSection,
    /a\.email IS NULL[\s\S]*?aei\.external_data->>'email'[\s\S]*?lower\(aei\.external_data->>'email'\)\s*=\s*lower\(v_user_email\)/,
    "trigger alumni lookup must include external_data fallback gated on a.email IS NULL",
  );
});

test("handle_org_member_sync alumni primary email match still gated on deleted_at IS NULL", () => {
  const src = readMigration();
  const triggerSection = src.split("CREATE OR REPLACE FUNCTION public.handle_org_member_sync")[1] ?? "";
  assert.match(
    triggerSection,
    /lower\(a\.email\)\s*=\s*lower\(v_user_email\)\s+AND a\.deleted_at IS NULL/,
    "trigger primary email arm must keep deleted_at IS NULL guard",
  );
});

test("migration preserves SECURITY DEFINER and search_path safety", () => {
  const src = readMigration();
  // Both recreated functions stay SECURITY DEFINER with empty search_path.
  const claimMatches = src.match(/CREATE OR REPLACE FUNCTION public\.claim_alumni_profiles[\s\S]*?\$\$;/);
  assert.ok(claimMatches, "claim function block found");
  assert.match(claimMatches![0], /SECURITY DEFINER/);
  assert.match(claimMatches![0], /SET search_path\s*=\s*''/);

  const triggerMatches = src.match(/CREATE OR REPLACE FUNCTION public\.handle_org_member_sync[\s\S]*?\$\$;/);
  assert.ok(triggerMatches, "trigger function block found");
  assert.match(triggerMatches![0], /SECURITY DEFINER/);
  assert.match(triggerMatches![0], /SET search_path\s*=\s*''/);
});

test("migration GRANTs claim RPC only to authenticated", () => {
  const src = readMigration();
  assert.match(
    src,
    /REVOKE ALL ON FUNCTION public\.claim_alumni_profiles\(\) FROM public/,
  );
  assert.match(
    src,
    /GRANT EXECUTE ON FUNCTION public\.claim_alumni_profiles\(\) TO authenticated/,
  );
});

test("claim RPC return-set still joins alumni via the same fallback (no surprise match)", () => {
  // The RETURN QUERY block should mirror the INSERT WHERE clause so the
  // function's reported orgs match the orgs it actually granted.
  const src = readMigration();
  const claimBlock = src.match(/CREATE OR REPLACE FUNCTION public\.claim_alumni_profiles[\s\S]*?\$\$;/)?.[0] ?? "";
  // RETURN QUERY exists and references aei.
  assert.match(claimBlock, /RETURN QUERY/);
  const returnSection = claimBlock.split("RETURN QUERY")[1] ?? "";
  assert.match(
    returnSection,
    /LEFT JOIN public\.alumni_external_ids aei/,
    "return-set must also LEFT JOIN alumni_external_ids",
  );
  assert.match(
    returnSection,
    /a\.email IS NULL[\s\S]*?aei\.external_data->>'email'/,
    "return-set must reuse the same fallback arm",
  );
});
