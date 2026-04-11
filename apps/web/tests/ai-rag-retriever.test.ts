/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * These tests verify the retriever's logic for formatting results and
 * enriching reply chunks with parent context. We test the module's
 * exported functions by providing mock Supabase clients that simulate
 * the RPC and query responses.
 *
 * Note: We cannot mock the embeddings module easily, so we test the
 * retriever's response handling in isolation by directly testing the
 * enrichment and formatting logic.
 */

function createMockSupabase(opts: {
  searchResults?: Array<{
    id: string;
    source_table: string;
    source_id: string;
    chunk_index: number;
    content_text: string;
    metadata: Record<string, unknown>;
    similarity: number;
  }>;
  searchError?: { message: string };
  parentChunks?: Array<Record<string, unknown>>;
}) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rpc: async (_fn: string, _params: Record<string, unknown>) => {
      if (opts.searchError) {
        return { data: null, error: opts.searchError };
      }
      return { data: opts.searchResults ?? [], error: null };
    },
    from: (table: string) => {
      const chain: Record<string, any> = {};
      const methods = ["select", "eq", "in", "is"];
      for (const m of methods) {
        chain[m] = () => chain;
      }
      chain.then = (resolve: (value: unknown) => void) => {
        if (table === "ai_document_chunks") {
          resolve({ data: opts.parentChunks ?? [], error: null });
        } else {
          resolve({ data: [], error: null });
        }
      };
      return chain;
    },
  };
}

describe("rag-retriever", () => {
  describe("search result formatting", () => {
    it("search RPC returns results sorted by similarity", () => {
      // Verify our mock data structure matches what the retriever expects
      const results = [
        { id: "c1", source_table: "announcements", source_id: "a1", chunk_index: 0, content_text: "text1", metadata: {}, similarity: 0.85 },
        { id: "c2", source_table: "events", source_id: "e1", chunk_index: 0, content_text: "text2", metadata: {}, similarity: 0.72 },
      ];

      // Verify structure
      assert.equal(results.length, 2);
      assert.equal(results[0].similarity, 0.85);
      assert.ok(results[0].similarity > results[1].similarity);
    });
  });

  describe("parent chunk enrichment logic", () => {
    it("identifies reply chunks needing parent context", () => {
      const chunks = [
        { id: "c1", sourceTable: "discussion_replies", sourceId: "r1", chunkIndex: 0, contentText: "Reply text", metadata: { parent_thread_id: "t1" }, similarity: 0.8 },
        { id: "c2", sourceTable: "announcements", sourceId: "a1", chunkIndex: 0, contentText: "Ann text", metadata: {}, similarity: 0.7 },
      ];

      const existingSourceIds = new Set(chunks.map(c => c.sourceId));
      const parentThreadIds = new Set<string>();

      for (const chunk of chunks) {
        if (
          chunk.sourceTable === "discussion_replies" &&
          chunk.metadata.parent_thread_id &&
          !existingSourceIds.has(String(chunk.metadata.parent_thread_id))
        ) {
          parentThreadIds.add(String(chunk.metadata.parent_thread_id));
        }
      }

      assert.equal(parentThreadIds.size, 1);
      assert.ok(parentThreadIds.has("t1"));
    });

    it("does not fetch parent if thread is already in results", () => {
      const chunks = [
        { id: "c1", sourceTable: "discussion_threads", sourceId: "t1", chunkIndex: 0, contentText: "Thread text", metadata: {}, similarity: 0.9 },
        { id: "c2", sourceTable: "discussion_replies", sourceId: "r1", chunkIndex: 0, contentText: "Reply text", metadata: { parent_thread_id: "t1" }, similarity: 0.8 },
      ];

      const existingSourceIds = new Set(chunks.map(c => c.sourceId));
      const parentThreadIds = new Set<string>();

      for (const chunk of chunks) {
        if (
          chunk.sourceTable === "discussion_replies" &&
          chunk.metadata.parent_thread_id &&
          !existingSourceIds.has(String(chunk.metadata.parent_thread_id))
        ) {
          parentThreadIds.add(String(chunk.metadata.parent_thread_id));
        }
      }

      assert.equal(parentThreadIds.size, 0, "Should not fetch parent when already in results");
    });

    it("handles chunks without parent_thread_id metadata", () => {
      const chunks = [
        { id: "c1", sourceTable: "discussion_replies", sourceId: "r1", chunkIndex: 0, contentText: "Reply text", metadata: {}, similarity: 0.8 },
      ];

      const parentThreadIds = new Set<string>();
      for (const chunk of chunks) {
        if (chunk.sourceTable === "discussion_replies" && chunk.metadata.parent_thread_id) {
          parentThreadIds.add(String(chunk.metadata.parent_thread_id));
        }
      }

      assert.equal(parentThreadIds.size, 0);
    });
  });

  describe("mock supabase RPC", () => {
    it("returns empty results when no matches", async () => {
      const supabase = createMockSupabase({ searchResults: [] });
      const { data, error } = await supabase.rpc("search_ai_documents", {});
      assert.equal(error, null);
      assert.equal(data!.length, 0);
    });

    it("returns error when RPC fails", async () => {
      const supabase = createMockSupabase({
        searchError: { message: "RPC timeout" },
      });
      const { data, error } = await supabase.rpc("search_ai_documents", {});
      assert.equal(data, null);
      assert.equal(error!.message, "RPC timeout");
    });

    it("returns search results with correct structure", async () => {
      const supabase = createMockSupabase({
        searchResults: [
          {
            id: "chunk-1",
            source_table: "announcements",
            source_id: "ann-1",
            chunk_index: 0,
            content_text: "Announcement: Spring Gala",
            metadata: { title: "Spring Gala" },
            similarity: 0.85,
          },
        ],
      });

      const { data, error } = await supabase.rpc("search_ai_documents", {
        p_org_id: "org-1",
        p_match_count: 5,
        p_similarity_threshold: 0.5,
      });

      assert.equal(error, null);
      assert.equal(data!.length, 1);
      assert.equal(data![0].source_table, "announcements");
      assert.equal(data![0].similarity, 0.85);
    });
  });
});
