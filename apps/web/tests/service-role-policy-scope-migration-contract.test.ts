import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contract test for the migration that scopes service-role-only RLS policies to
// the service_role (instead of PUBLIC), so they stop stacking onto every
// anon/authenticated query as an always-false branch. If a future migration
// reintroduces one of these as PUBLIC, the Supabase advisor would re-flag it
// (multiple_permissive_policies) — this catches the regression at the source.

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20261218020000_scope_service_role_policies.sql",
    import.meta.url
  ),
  "utf8"
);

// Each [table, policy] that must be scoped TO service_role.
const expected: Array<[string, string]> = [
  ["alumni_external_ids", "alumni_external_ids_service_role"],
  ["analytics_events", "service_role_only"],
  ["analytics_ops_events", "service_role_only"],
  ["dev_admin_audit_logs", "dev_admin_audit_logs_service_write"],
  ["dsr_requests", "dsr_requests_service_only"],
  ["enterprise_adoption_requests", "enterprise_adoption_requests_service_all"],
  ["enterprise_audit_logs", "enterprise_audit_logs_service_only"],
  ["enterprise_deletion_requests", "enterprise_deletion_requests_service_only"],
  ["enterprise_invites", "enterprise_invites_service_all"],
  ["enterprise_subscriptions", "enterprise_subscriptions_service_all"],
  ["enterprises", "enterprises_service_all"],
  ["integration_sync_log", "integration_sync_log_service_role"],
  ["ops_events", "service_role_only"],
  ["org_integration_oauth_state", "oauth_state_service_role"],
  ["org_integrations", "org_integrations_service_role"],
  ["payment_attempts", "payment_attempts_service_only"],
  ["rate_limit_analytics", "service_role_only"],
  ["schedule_allowed_domains", "service_role_only"],
  ["schedule_domain_rules", "service_role_only"],
  ["stripe_events", "stripe_events_service_only"],
  ["usage_events", "service_role_only"],
  ["usage_summaries", "service_role_only"],
  ["user_enterprise_roles", "user_enterprise_roles_service_all"],
];

describe("service-role policy scoping — migration contract", () => {
  for (const [tbl, policy] of expected) {
    it(`scopes ${policy} on ${tbl} to service_role`, () => {
      const re = new RegExp(
        `alter policy ${policy} on public\\.${tbl} to service_role;`,
        "i"
      );
      assert.match(migration, re);
    });
  }

  it("uses ALTER POLICY (preserving USING/CHECK), never re-grants to PUBLIC/anon/authenticated", () => {
    const sql = migration.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(sql, /to (public|anon|authenticated)\b/i);
    const alters = sql.match(/alter policy /gi) ?? [];
    assert.equal(alters.length, expected.length);
  });
});
