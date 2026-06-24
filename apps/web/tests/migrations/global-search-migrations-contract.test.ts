import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "supabase/migrations");

function read(name: string) {
  return readFileSync(join(root, name), "utf8");
}

describe("global search migrations (contract)", () => {
  it("enables pg_trgm and defines search_org_content with hardened search_path", () => {
    const sql = read("20261015110000_global_search.sql");
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.search_org_content/i);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = ''/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.search_org_content/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.search_org_content[^;]+TO authenticated/);
  });

  it("reconciles announcement visibility and adds filter RPC", () => {
    const sql = read("20261015100000_reconcile_announcement_visibility.sql");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.can_view_announcement/);
    assert.match(sql, /filter_announcement_ids_for_user/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.filter_announcement_ids_for_user/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.filter_announcement_ids_for_user[^;]+TO authenticated/);
  });

  it("extends analytics enum and allowlists search telemetry keys", () => {
    const sql = read("20261015120000_search_behavioral_analytics.sql");
    assert.match(sql, /search_used/);
    assert.match(sql, /search_result_click/);
    assert.match(sql, /WHEN 'search_used' THEN ARRAY\['query_length','result_count','mode'\]/);
    assert.match(sql, /WHEN 'search_result_click' THEN ARRAY\['query_length','mode','clicked_entity_type','result_position'\]/);
    assert.match(sql, /v_key <> 'query_length'/);
  });

  it("adds knowledge_documents to search_org_content with hardening and broad-only gating", () => {
    const sql = read("20261225000000_search_org_content_knowledge.sql");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.search_org_content/i);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = ''/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.search_org_content/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.search_org_content[^;]+TO authenticated/);
    // Broad-only audience gate (D1): admins-restricted docs never flow through keyword search.
    assert.match(sql, /COALESCE\(kd\.audience, 'all'\) IN \('all', 'both'\)/);
    assert.match(sql, /knowledge_rows/);
    assert.match(sql, /SELECT \* FROM knowledge_rows/);
  });

  it("hardens knowledge_documents: audience CHECK, hard-delete cleanup, backfill parity", () => {
    const sql = read("20261226000000_knowledge_documents_hardening.sql");
    // (#3) audience allowlist CHECK with the exact supported tokens.
    assert.match(sql, /knowledge_documents_audience_check/);
    assert.match(
      sql,
      /CHECK \(audience IN \('all', 'both', 'members', 'active_members', 'alumni', 'admins'\)\)/
    );
    // (#2) AFTER DELETE chunk-cleanup path using OLD, wired to knowledge_documents.
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.enqueue_ai_embedding_delete/i);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = ''/);
    assert.match(sql, /VALUES \(OLD\.organization_id, TG_TABLE_NAME, OLD\.id, 'delete'\)/);
    assert.match(sql, /AFTER DELETE ON public\.knowledge_documents/);
    // (#4) backfill parity: the two previously-missing source tables are now scanned.
    assert.match(sql, /source_table = 'mentor_profiles'/);
    assert.match(sql, /source_table = 'form_submissions'/);
  });

  it("defines a hardened compact org stats snapshot RPC", () => {
    const sql = read("20261027000000_ai_org_stats_snapshot.sql");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_org_stats_snapshot/i);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = ''/);
    assert.match(sql, /user_organization_roles/);
    assert.match(sql, /organization_donation_stats/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_org_stats_snapshot/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_org_stats_snapshot[^;]+TO authenticated/);
  });
});
