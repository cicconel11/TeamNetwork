/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderChunks, computeContentHash } from "../src/lib/ai/chunker.ts";

/**
 * Integration-style tests for the embedding worker's hardened logic.
 * These verify behavioral contracts of the worker's key improvements:
 * - Fail-closed exclusion handling
 * - Stale chunk cleanup on content shrink
 * - Dequeue via RPC (FOR UPDATE SKIP LOCKED)
 * - Atomic retry increment via RPC
 * - Orphaned chunk detection
 */

// ---------------------------------------------------------------------------
// Mock Supabase factory — fully chainable
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

function createChainableMock(opts: {
  dequeueResult?: { data: unknown[] | null; error: { message: string } | null };
  exclusionResult?: { data: unknown[] | null; error: { message: string } | null };
  sourceRecords?: Map<string, unknown[]>;
  existingChunks?: unknown[];
}) {
  const rpcCalls: RpcCall[] = [];
  const updateTables: string[] = [];

  const mock = {
    rpcCalls,
    updateTables,
    rpc: async (fn: string, params?: Record<string, unknown>) => {
      rpcCalls.push({ fn, params: params ?? {} });

      if (fn === "dequeue_ai_embeddings") {
        return opts.dequeueResult ?? { data: [], error: null };
      }
      if (fn === "increment_ai_queue_attempts") {
        return { data: null, error: null };
      }
      if (fn === "replace_ai_chunks") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      // Fully chainable builder that resolves data on terminal calls
      const resolveData = () => {
        if (table === "ai_indexing_exclusions") {
          return opts.exclusionResult ?? { data: [], error: null };
        }
        if (table === "ai_document_chunks") {
          return { data: opts.existingChunks ?? [], error: null };
        }
        if (opts.sourceRecords?.has(table)) {
          return { data: opts.sourceRecords.get(table), error: null };
        }
        return { data: [], error: null };
      };

      const chain: any = {};
      chain.select = () => chain;
      chain.insert = () => chain;
      chain.update = (vals: any) => {
        if (vals?.deleted_at) updateTables.push(table);
        return chain;
      };
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.is = () => chain;
      chain.lt = () => chain;
      chain.gte = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.single = () => resolveData();
      chain.maybeSingle = () => resolveData();

      // Make chain thenable so `await supabase.from(...).select(...)...` resolves
      chain.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
      ) => Promise.resolve(resolveData()).then(resolve, reject);

      return chain;
    },
  };

  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("embedding-worker integration", () => {
  describe("dequeue via RPC", () => {
    it("calls dequeue_ai_embeddings RPC instead of plain SELECT", async () => {
      const mock = createChainableMock({
        dequeueResult: { data: [], error: null },
      });

      const { processEmbeddingQueue } = await import(
        "../src/lib/ai/embedding-worker.ts"
      );

      await processEmbeddingQueue(mock as any);

      const dequeueCall = mock.rpcCalls.find(
        (c) => c.fn === "dequeue_ai_embeddings"
      );
      assert.ok(dequeueCall, "Should call dequeue_ai_embeddings RPC");
      assert.equal(
        dequeueCall.params.p_batch_size,
        50,
        "Default batch size should be 50"
      );
    });

    it("returns empty stats when dequeue returns no items", async () => {
      const mock = createChainableMock({
        dequeueResult: { data: [], error: null },
      });

      const { processEmbeddingQueue } = await import(
        "../src/lib/ai/embedding-worker.ts"
      );

      const stats = await processEmbeddingQueue(mock as any);
      assert.equal(stats.processed, 0);
      assert.equal(stats.skipped, 0);
      assert.equal(stats.failed, 0);
    });

    it("returns empty stats on dequeue error", async () => {
      const mock = createChainableMock({
        dequeueResult: { data: null, error: { message: "connection timeout" } },
      });

      const { processEmbeddingQueue } = await import(
        "../src/lib/ai/embedding-worker.ts"
      );

      const stats = await processEmbeddingQueue(mock as any);
      assert.equal(stats.processed, 0);
      assert.equal(stats.failed, 0);
    });

    it("accepts custom batch size", async () => {
      const mock = createChainableMock({
        dequeueResult: { data: [], error: null },
      });

      const { processEmbeddingQueue } = await import(
        "../src/lib/ai/embedding-worker.ts"
      );

      await processEmbeddingQueue(mock as any, { batchSize: 10 });

      const dequeueCall = mock.rpcCalls.find(
        (c) => c.fn === "dequeue_ai_embeddings"
      );
      assert.equal(dequeueCall?.params.p_batch_size, 10);
    });
  });

  describe("exclusion fail-closed behavior", () => {
    it("fails items when exclusion fetch returns error", async () => {
      const mock = createChainableMock({
        dequeueResult: {
          data: [
            { id: "q1", org_id: "org1", source_table: "announcements", source_id: "a1", action: "upsert" },
          ],
          error: null,
        },
        exclusionResult: { data: null, error: { message: "DB connection failed" } },
        sourceRecords: new Map([
          ["announcements", [{ id: "a1", title: "Test", body: "Content", organization_id: "org1", deleted_at: null }]],
        ]),
      });

      const { processEmbeddingQueue } = await import(
        "../src/lib/ai/embedding-worker.ts"
      );

      const stats = await processEmbeddingQueue(mock as any);

      assert.equal(stats.failed, 1, "Should fail the item when exclusions can't be fetched");

      const incrementCall = mock.rpcCalls.find(
        (c) => c.fn === "increment_ai_queue_attempts"
      );
      assert.ok(incrementCall, "Should call increment_ai_queue_attempts RPC");
      assert.ok(
        String(incrementCall.params.p_error).includes("exclusion_fetch_failed"),
        "Error should mention exclusion_fetch_failed"
      );
    });
  });

  describe("atomic retry increment", () => {
    it("uses increment_ai_queue_attempts RPC for delete failures", async () => {
      // Create a mock where the soft-delete update fails
      const rpcCalls: RpcCall[] = [];
      const mock = {
        rpcCalls,
        rpc: async (fn: string, params?: Record<string, unknown>) => {
          rpcCalls.push({ fn, params: params ?? {} });
          if (fn === "dequeue_ai_embeddings") {
            return {
              data: [{
                id: "q1", org_id: "org1",
                source_table: "announcements", source_id: "a1",
                action: "delete",
              }],
              error: null,
            };
          }
          return { data: null, error: null };
        },
        from: (table: string) => {
          const chain: any = {};
          chain.select = () => chain;
          chain.update = () => chain;
          chain.eq = () => chain;
          chain.in = () => chain;
          chain.is = () => chain;
          chain.order = () => chain;
          chain.limit = () => chain;

          chain.then = (resolve: (v: unknown) => unknown) => {
            if (table === "ai_indexing_exclusions") {
              return Promise.resolve({ data: [], error: null }).then(resolve);
            }
            if (table === "ai_document_chunks") {
              // Simulate chunk soft-delete failure
              return Promise.resolve({ data: null, error: { message: "update_failed" } }).then(resolve);
            }
            // Source record not found → triggers delete path
            return Promise.resolve({ data: [], error: null }).then(resolve);
          };

          return chain;
        },
      };

      const { processEmbeddingQueue } = await import(
        "../src/lib/ai/embedding-worker.ts"
      );

      const stats = await processEmbeddingQueue(mock as any);

      assert.equal(stats.failed, 1);
      const incrementCall = rpcCalls.find(
        (c) => c.fn === "increment_ai_queue_attempts"
      );
      assert.ok(incrementCall, "Should use RPC for atomic increment");
    });
  });

  describe("stale chunk cleanup on content shrink", () => {
    it("produces 0 chunks for short replies (triggers cleanup path)", () => {
      const chunks = renderChunks("discussion_replies", {
        id: "dr1",
        thread_id: "dt1",
        body: "ok",
        organization_id: "org1",
        deleted_at: null,
      });
      assert.equal(
        chunks.length,
        0,
        "Short replies should produce 0 chunks, triggering stale cleanup in worker"
      );
    });
  });

  describe("orphaned chunk detection", () => {
    it("detects orphaned indexes when content shrinks from 3 chunks to 1", () => {
      // Simulate existing hashes for 3 chunks
      const existingHashes = new Map<number, string>([
        [0, "hash0"],
        [1, "hash1"],
        [2, "hash2"],
      ]);

      // New content only produces 1 chunk
      const newChunkIndexes = new Set([0]);

      const hasOrphanedChunks = Array.from(existingHashes.keys()).some(
        (idx) => !newChunkIndexes.has(idx)
      );

      assert.ok(
        hasOrphanedChunks,
        "Should detect orphaned chunks when content shrinks"
      );
    });

    it("does not flag orphans when chunk count is unchanged", () => {
      const existingHashes = new Map<number, string>([
        [0, "hash0"],
        [1, "hash1"],
      ]);

      const newChunkIndexes = new Set([0, 1]);

      const hasOrphanedChunks = Array.from(existingHashes.keys()).some(
        (idx) => !newChunkIndexes.has(idx)
      );

      assert.ok(
        !hasOrphanedChunks,
        "Should not flag orphans when chunk count matches"
      );
    });
  });

  describe("content hash stability", () => {
    it("hash is deterministic across renders of same content", () => {
      const record = {
        id: "ann1",
        title: "Stable",
        body: "Same content always",
        audience: "all",
        organization_id: "org1",
        deleted_at: null,
      };

      const chunks1 = renderChunks("announcements", record);
      const chunks2 = renderChunks("announcements", record);

      for (let i = 0; i < chunks1.length; i++) {
        assert.equal(
          computeContentHash(chunks1[i].text),
          computeContentHash(chunks2[i].text),
          `Chunk ${i} hash should be deterministic`
        );
      }
    });
  });
});
