import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contract test for the RLS InitPlan performance follow-up migration. The whole
// point of the migration is that every auth.uid()/auth.role() call inside a
// policy is wrapped in `(select ...)` so Postgres evaluates it once per query
// (InitPlan) instead of once per row. If a future edit reintroduces a bare call,
// the Supabase performance advisor would re-flag it — this test catches it first.

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20261218010000_rls_initplan_auth_uid_followup.sql",
    import.meta.url
  ),
  "utf8"
);

describe("RLS InitPlan follow-up — migration contract", () => {
  it("contains no bare auth.uid()/auth.role() (every call must be wrapped in (select ...))", () => {
    // Strip `--` line comments so prose mentioning auth.uid() isn't flagged.
    const sql = migration.replace(/--[^\n]*/g, "");
    const bare: string[] = [];
    const re = /auth\.(uid|role)\(\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const preceding = sql.slice(Math.max(0, m.index - 8), m.index).toLowerCase();
      if (!preceding.endsWith("select ")) {
        const ctx = sql.slice(Math.max(0, m.index - 30), m.index + 12);
        bare.push(ctx.replace(/\s+/g, " ").trim());
      }
    }
    assert.deepEqual(bare, [], `bare auth calls found: ${JSON.stringify(bare)}`);
  });

  it("recreates each flagged policy that the advisor reported", () => {
    for (const policy of [
      "user_push_tokens_select",
      "onboarding_progress_update",
      "notification_reads_select_own",
      "user_agreements_select",
      "ai_feedback_insert",
      "ai_spend_ledger_admin_select",
      "org_member_role_audit_admin_select",
      "discussion_replies_insert",
      "enterprise_deletion_requests_service_only",
      "mentorship_pairs_select",
    ]) {
      assert.match(
        migration,
        new RegExp(`create policy ${policy} on public\\.`, "i"),
        `missing recreate for policy ${policy}`
      );
    }
  });

  it("preserves the service-role gate on enterprise_deletion_requests", () => {
    assert.match(
      migration,
      /enterprise_deletion_requests[\s\S]*?\(select auth\.role\(\)\) = 'service_role'/i
    );
  });
});
