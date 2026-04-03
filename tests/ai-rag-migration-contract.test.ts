import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), "utf-8");
}

describe("RAG migration contract", () => {
  describe("20260711000000_ai_rag_foundation.sql", () => {
    let sql: string;

    it("migration file exists", () => {
      sql = readMigration("20260711000000_ai_rag_foundation.sql");
      assert.ok(sql.length > 0);
    });

    it("creates ai_document_chunks table", () => {
      assert.ok(sql.includes("CREATE TABLE public.ai_document_chunks"));
    });

    it("creates ai_embedding_queue table", () => {
      assert.ok(sql.includes("CREATE TABLE public.ai_embedding_queue"));
    });

    it("creates ai_indexing_exclusions table", () => {
      assert.ok(sql.includes("CREATE TABLE public.ai_indexing_exclusions"));
    });

    it("ai_document_chunks has vector(768) embedding column", () => {
      assert.ok(sql.includes("extensions.vector(768)"));
    });

    it("creates HNSW index for vector search", () => {
      assert.ok(sql.includes("USING hnsw"));
      assert.ok(sql.includes("idx_ai_chunks_embedding_hnsw"));
    });

    it("creates unique index for source deduplication", () => {
      assert.ok(sql.includes("idx_ai_chunks_source_unique"));
    });

    it("creates pending queue index", () => {
      assert.ok(sql.includes("idx_ai_embedding_queue_pending"));
    });

    it("enables RLS on all tables", () => {
      assert.ok(sql.includes("ALTER TABLE public.ai_document_chunks ENABLE ROW LEVEL SECURITY"));
      assert.ok(sql.includes("ALTER TABLE public.ai_embedding_queue ENABLE ROW LEVEL SECURITY"));
      assert.ok(sql.includes("ALTER TABLE public.ai_indexing_exclusions ENABLE ROW LEVEL SECURITY"));
    });

    it("creates admin RLS policy for indexing exclusions", () => {
      assert.ok(sql.includes("ai_indexing_exclusions_admin"));
    });

    it("source_table CHECK constraint includes all 5 tables", () => {
      const tables = ["announcements", "discussion_threads", "discussion_replies", "events", "job_postings"];
      for (const table of tables) {
        assert.ok(sql.includes(`'${table}'`), `Missing source table: ${table}`);
      }
    });
  });

  describe("20260711000001_ai_rag_queue_triggers.sql", () => {
    let sql: string;

    it("migration file exists", () => {
      sql = readMigration("20260711000001_ai_rag_queue_triggers.sql");
      assert.ok(sql.length > 0);
    });

    it("creates enqueue_ai_embedding trigger function", () => {
      assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding"));
    });

    it("trigger function is SECURITY DEFINER", () => {
      const match = sql.match(/enqueue_ai_embedding[\s\S]*?SECURITY DEFINER/);
      assert.ok(match, "enqueue_ai_embedding should be SECURITY DEFINER");
    });

    it("creates triggers on all 5 source tables", () => {
      assert.ok(sql.includes("trg_ai_embed_announcements"));
      assert.ok(sql.includes("trg_ai_embed_events"));
      assert.ok(sql.includes("trg_ai_embed_discussion_threads"));
      assert.ok(sql.includes("trg_ai_embed_discussion_replies"));
      assert.ok(sql.includes("trg_ai_embed_job_postings"));
    });

    it("creates search_ai_documents RPC", () => {
      assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.search_ai_documents"));
    });

    it("search_ai_documents accepts vector(768) parameter", () => {
      assert.ok(sql.includes("p_query_embedding extensions.vector(768)"));
    });

    it("search_ai_documents default threshold is 0.5", () => {
      assert.ok(sql.includes("p_similarity_threshold float DEFAULT 0.5"));
    });

    it("creates backfill_ai_embedding_queue RPC", () => {
      assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.backfill_ai_embedding_queue"));
    });

    it("backfill includes all 5 source tables", () => {
      // Check that backfill queries each table
      const tables = ["announcements", "events", "discussion_threads", "discussion_replies", "job_postings"];
      for (const table of tables) {
        assert.ok(
          sql.includes(`'${table}'`),
          `Backfill should include ${table}`
        );
      }
    });

    it("creates purge_ai_embedding_queue RPC", () => {
      assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.purge_ai_embedding_queue"));
    });

    it("search RPC is granted to service_role only", () => {
      assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.search_ai_documents TO service_role"));
      assert.ok(!sql.includes("GRANT EXECUTE ON FUNCTION public.search_ai_documents TO authenticated"),
        "search_ai_documents should NOT be granted to authenticated (cross-org risk)");
    });

    it("backfill RPC is service_role only", () => {
      assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.backfill_ai_embedding_queue TO service_role"));
      assert.ok(sql.includes("REVOKE EXECUTE ON FUNCTION public.backfill_ai_embedding_queue FROM authenticated"));
    });
  });

  describe("20260711000002_ai_audit_rag_columns.sql", () => {
    let sql: string;

    it("migration file exists", () => {
      sql = readMigration("20260711000002_ai_audit_rag_columns.sql");
      assert.ok(sql.length > 0);
    });

    it("adds rag_chunk_count column", () => {
      assert.ok(sql.includes("rag_chunk_count"));
    });

    it("adds rag_top_similarity column", () => {
      assert.ok(sql.includes("rag_top_similarity"));
    });

    it("adds rag_error column", () => {
      assert.ok(sql.includes("rag_error"));
    });
  });

  describe("20260711100000_ai_rag_gemini_768_dims.sql", () => {
    let sql: string;

    it("migration file exists", () => {
      sql = readMigration("20260711100000_ai_rag_gemini_768_dims.sql");
      assert.ok(sql.length > 0);
    });

    it("changes embedding column to vector(768)", () => {
      assert.ok(sql.includes("vector(768)"));
    });

    it("recreates HNSW index", () => {
      assert.ok(sql.includes("idx_ai_chunks_embedding_hnsw"));
      assert.ok(sql.includes("USING hnsw"));
    });

    it("recreates search RPC with vector(768)", () => {
      assert.ok(sql.includes("search_ai_documents"));
      assert.ok(sql.includes("p_query_embedding extensions.vector(768)"));
    });
  });

  describe("20260711100001_ai_rag_security_fixes.sql", () => {
    let sql: string;

    it("migration file exists", () => {
      sql = readMigration("20260711100001_ai_rag_security_fixes.sql");
      assert.ok(sql.length > 0);
    });

    it("revokes authenticated access to search_ai_documents", () => {
      assert.ok(sql.includes("REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM authenticated"));
    });

    it("purge only deletes completed or dead-letter items", () => {
      assert.ok(sql.includes("processed_at IS NOT NULL OR attempts >= 3"));
    });
  });

  describe("20260807000000_fix_ai_embedding_trigger_field_access.sql", () => {
    let sql: string;

    it("migration file exists", () => {
      sql = readMigration("20260807000000_fix_ai_embedding_trigger_field_access.sql");
      assert.ok(sql.length > 0);
    });

    it("replaces enqueue_ai_embedding with source-table-aware branching", () => {
      assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding()"));
      assert.ok(sql.includes("TG_TABLE_NAME = 'announcements'"));
      assert.ok(sql.includes("TG_TABLE_NAME = 'events'"));
      assert.ok(sql.includes("TG_TABLE_NAME = 'discussion_threads'"));
      assert.ok(sql.includes("TG_TABLE_NAME = 'discussion_replies'"));
      assert.ok(sql.includes("TG_TABLE_NAME = 'job_postings'"));
    });

    it("does not inspect body fields in the events trigger branch", () => {
      const eventBranch = sql.match(
        /ELSIF TG_TABLE_NAME = 'events' THEN([\s\S]*?)ELSIF TG_TABLE_NAME = 'discussion_threads' THEN/
      );

      assert.ok(eventBranch, "expected an explicit events branch in enqueue_ai_embedding");
      assert.doesNotMatch(eventBranch[1], /NEW\.body|OLD\.body/i);
      assert.match(eventBranch[1], /NEW\.description|OLD\.description/i);
      assert.match(eventBranch[1], /NEW\.start_date|OLD\.start_date/i);
      assert.match(eventBranch[1], /NEW\.end_date|OLD\.end_date/i);
      assert.match(eventBranch[1], /NEW\.location|OLD\.location/i);
      assert.match(eventBranch[1], /NEW\.audience|OLD\.audience/i);
    });

    it("preserves delete enqueue behavior and queue dedupe", () => {
      assert.match(sql, /VALUES \(NEW\.organization_id, TG_TABLE_NAME, NEW\.id, 'delete'\)/);
      assert.match(sql, /VALUES \(NEW\.organization_id, TG_TABLE_NAME, NEW\.id, 'upsert'\)/);
      assert.match(sql, /ON CONFLICT DO NOTHING/);
    });
  });
});
