import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const WEB_ROOT = join(__dirname, "..");
const REPO_ROOT = join(WEB_ROOT, "..", "..");

const FILE = "20261224000000_knowledge_documents.sql";

describe("knowledge_documents migration contract", () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, FILE), "utf-8");

  it("creates the knowledge_documents table with required pipeline columns", () => {
    assert.ok(sql.includes("CREATE TABLE public.knowledge_documents"));
    for (const col of [
      "organization_id",
      "title",
      "body",
      "audience",
      "deleted_at",
      "created_by",
    ]) {
      assert.ok(sql.includes(col), `missing column: ${col}`);
    }
  });

  it("defaults audience to the broadly-visible 'all' token", () => {
    assert.match(sql, /audience\s+text\s+NOT NULL\s+DEFAULT\s+'all'/);
  });

  it("enables RLS and adds an admin-only policy", () => {
    assert.ok(sql.includes("ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY"));
    assert.ok(sql.includes("knowledge_documents_admin"));
    assert.ok(sql.includes("has_active_role(organization_id, array['admin'])"));
  });

  it("rebuilds the source_table CHECK idempotently with all 8 tables (timing-safe)", () => {
    assert.ok(
      sql.includes("DROP CONSTRAINT IF EXISTS ai_document_chunks_source_table_check"),
      "must DROP IF EXISTS before re-adding (timing-safe vs the CHECK-sync PR)"
    );
    for (const table of [
      "announcements",
      "discussion_threads",
      "discussion_replies",
      "events",
      "job_postings",
      "mentor_profiles",
      "form_submissions",
      "knowledge_documents",
    ]) {
      assert.ok(sql.includes(`'${table}'`), `CHECK rebuild missing table: ${table}`);
    }
  });

  it("adds the embedding trigger on knowledge_documents", () => {
    assert.ok(sql.includes("trg_ai_embed_knowledge_documents"));
    assert.ok(sql.includes("AFTER INSERT OR UPDATE ON public.knowledge_documents"));
    assert.ok(sql.includes("EXECUTE FUNCTION public.enqueue_ai_embedding()"));
  });

  it("recreates enqueue_ai_embedding with a knowledge_documents change-detection branch", () => {
    assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding()"));
    assert.ok(sql.includes("TG_TABLE_NAME = 'knowledge_documents'"));
  });

  it("extends backfill_ai_embedding_queue with a knowledge_documents scan block", () => {
    assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.backfill_ai_embedding_queue"));
    assert.match(
      sql,
      /'knowledge_documents', kd\.id, 'upsert'\s+FROM public\.knowledge_documents kd/
    );
  });

  it("reuses the shared updated_at trigger function", () => {
    assert.ok(sql.includes("EXECUTE FUNCTION public.update_updated_at_column()"));
  });

  it("keeps generated DB types and the OKF schema bundle in sync", () => {
    const appTypes = readFileSync(join(WEB_ROOT, "src", "types", "database.ts"), "utf-8");
    const packageTypes = readFileSync(
      join(REPO_ROOT, "packages", "types", "src", "database.ts"),
      "utf-8"
    );
    const okfIndex = readFileSync(join(REPO_ROOT, "docs", "db", "okf", "index.md"), "utf-8");
    const okfDoc = readFileSync(
      join(REPO_ROOT, "docs", "db", "okf", "knowledge_documents.md"),
      "utf-8"
    );

    assert.match(appTypes, /knowledge_documents:\s*\{/);
    assert.match(packageTypes, /knowledge_documents:\s*\{/);
    assert.match(okfIndex, /\[knowledge_documents\]\(\.\/knowledge_documents\.md\)/);
    assert.match(okfDoc, /title: "knowledge_documents"/);
  });
});
