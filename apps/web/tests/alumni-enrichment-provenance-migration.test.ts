import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL(
    "../supabase/migrations/20261219000000_alumni_enrichment_provenance.sql",
    import.meta.url
  ),
  "utf8"
);

test("adds enrichment_filled_fields text[] column to public.alumni", () => {
  assert.match(
    sql,
    /alter table public\.alumni add column if not exists enrichment_filled_fields text\[\];/i
  );
  // Provenance column is documented for the edit UI.
  assert.match(
    sql,
    /comment on column public\.alumni\.enrichment_filled_fields/i
  );
});

test("redefines both enrichment RPCs with CREATE OR REPLACE", () => {
  assert.match(
    sql,
    /create or replace function public\.enrich_alumni_by_id\s*\(/i
  );
  assert.match(
    sql,
    /create or replace function public\.sync_user_linkedin_enrichment\s*\(/i
  );
});

test("both RPCs are SECURITY DEFINER with empty search_path", () => {
  const functions = sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
  assert.equal(functions.length, 2, "expected exactly two function definitions");
  for (const fn of functions) {
    assert.match(fn, /language plpgsql/i);
    assert.match(fn, /security definer/i);
    assert.match(fn, /set search_path = ''/i);
  }
});

test("provenance is written in UPDATE SET with union/merge of prior array", () => {
  // The column must appear as an UPDATE SET target.
  const setAssignments = sql.match(/enrichment_filled_fields = /gi) ?? [];
  assert.ok(
    setAssignments.length >= 3,
    "expected provenance SET in enrich_alumni_by_id + both sync branches"
  );
  // Merge semantics: prior array unioned with newly-filled fields, deduped.
  const merges =
    sql.match(
      /coalesce\(enrichment_filled_fields, '\{\}'::text\[\]\) \|\| array_remove\(array\[/gi
    ) ?? [];
  assert.ok(
    merges.length >= 3,
    "every provenance write must union with the prior array"
  );
  const dedupes = sql.match(/array_agg\(distinct f\)/gi) ?? [];
  assert.ok(dedupes.length >= 3, "union must dedupe via array_agg(DISTINCT f)");
});

test("service_role grants carried over from 20261208000000 for both RPCs", () => {
  // 20261208000000 declares exactly these two GRANT EXECUTE ... TO service_role
  // statements (and no REVOKEs); the re-create must preserve them verbatim.
  assert.match(
    sql,
    /grant execute on function public\.enrich_alumni_by_id\(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, text, text, jsonb, jsonb, jsonb\) to service_role;/i
  );
  assert.match(
    sql,
    /grant execute on function public\.sync_user_linkedin_enrichment\(uuid, text, text, text, text, text, text, jsonb, text, text, jsonb, jsonb, boolean, text, text, jsonb, jsonb, jsonb\) to service_role;/i
  );
});

test("function bodies contain verbatim anchor lines from 20261208000000", () => {
  // Diff-sanity anchors: distinctive lines copied byte-for-byte from the
  // source migration so a sloppy re-type fails this test.
  const anchors = [
    "    education_history = COALESCE(education_history, p_education_history),",
    "      role = COALESCE(p_job_title, role),",
    "    SET linkedin_data = linkedin_data || jsonb_build_object('enrichment', p_enrichment_json)",
    "    'updated_count', v_members_updated + v_alumni_updated + v_parents_updated",
  ];
  for (const anchor of anchors) {
    assert.ok(sql.includes(anchor), `missing verbatim anchor line: ${anchor}`);
  }
});

test("anchor lines really exist in the 20261208000000 source migration", async () => {
  const source = await readFile(
    new URL(
      "../supabase/migrations/20261208000000_apify_enrichment_richer_fields.sql",
      import.meta.url
    ),
    "utf8"
  );
  for (const anchor of [
    "    education_history = COALESCE(education_history, p_education_history),",
    "      role = COALESCE(p_job_title, role),",
    "    SET linkedin_data = linkedin_data || jsonb_build_object('enrichment', p_enrichment_json)",
  ]) {
    assert.ok(
      source.includes(anchor),
      `anchor no longer present in source migration: ${anchor}`
    );
  }
});

test("dollar-quoted bodies are balanced", () => {
  const markers = sql.match(/\$\$/g) ?? [];
  assert.equal(markers.length % 2, 0, "unbalanced $$ quoting");
  assert.equal(markers.length, 4, "expected two $$-quoted function bodies");
});
