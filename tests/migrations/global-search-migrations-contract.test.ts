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
});
