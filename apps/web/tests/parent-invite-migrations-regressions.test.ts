import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

function getMigrationFiles(): string[] {
  return fs.readdirSync(migrationsDir).sort();
}

function getLatestRedeemParentInviteSql(): string {
  const files = getMigrationFiles();
  let latestSql = "";

  const pattern = /create or replace function public\.redeem_parent_invite\(p_code text\)[\s\S]*?\$\$;/i;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const match = sql.match(pattern);
    if (!match) continue;
    latestSql = match[0];
  }

  return latestSql;
}

function countMatches(input: string, pattern: RegExp): number {
  return Array.from(input.matchAll(pattern)).length;
}

test("redeem_parent_invite follow-up migrations sort after the current schema head", () => {
  const files = getMigrationFiles();
  const followUps = files.filter((file) =>
    /fix_redeem_parent_invite_revoked_branch|fix_redeem_parent_invite_claim_guard|fix_redeem_parent_invite_ambiguous_parent_matches|grant_redeem_parent_invite/.test(
      file
    )
  );

  assert.equal(followUps.length, 4);
  for (const file of followUps) {
    assert.ok(
      file > "20260631000000_org_member_sync_skip_revoked.sql",
      `Expected ${file} to sort after 20260631000000_org_member_sync_skip_revoked.sql`
    );
  }
});

test("latest redeem_parent_invite rejects ambiguous parent matches instead of using LIMIT 1", () => {
  const sql = getLatestRedeemParentInviteSql();

  const byUserMatches = countMatches(
    sql,
    /select id[\s\S]*?from public\.parents[\s\S]*?organization_id = v_invite\.organization_id[\s\S]*?user_id = v_user_id[\s\S]*?deleted_at is null[\s\S]*?limit 2/gi
  );
  const byEmailMatches = countMatches(
    sql,
    /select id[\s\S]*?from public\.parents[\s\S]*?organization_id = v_invite\.organization_id[\s\S]*?lower\(email\) = lower\(v_user_email\)[\s\S]*?deleted_at is null[\s\S]*?limit 2/gi
  );
  const limit1ParentLookups = countMatches(
    sql,
    /from public\.parents[\s\S]*?organization_id = v_invite\.organization_id[\s\S]*?deleted_at is null[\s\S]*?limit 1;/gi
  );
  const ambiguousGuardReturns = countMatches(
    sql,
    /return jsonb_build_object\('success', false, 'error', v_ambiguous_parent_error\);/gi
  );

  assert.equal(byUserMatches, 2, "Expected duplicate detection on both org+user parent lookups");
  assert.equal(byEmailMatches, 2, "Expected duplicate detection on both org+email parent lookups");
  assert.equal(limit1ParentLookups, 0, "Expected duplicate-prone parent lookups to stop using LIMIT 1");
  assert.equal(ambiguousGuardReturns, 4, "Expected ambiguity guards on both lookup types in both branches");
  assert.match(
    sql,
    /Multiple parent records match this account\. Please contact your organization admin\./,
    "Expected an explicit handled error for ambiguous parent matches"
  );
});
