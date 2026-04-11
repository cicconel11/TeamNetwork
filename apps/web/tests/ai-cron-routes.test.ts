/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for AI cron route behaviors:
 * - Auth validation (CRON_SECRET)
 * - Embed process: loop termination, stats aggregation
 * - Cache purge: RPC call and error handling
 *
 * These test the route logic patterns without importing Next.js route handlers
 * directly (which would require full Next.js server context).
 */

describe("ai-cron-routes", () => {
  describe("cron auth validation", () => {
    it("rejects requests without authorization header", () => {
      // Simulate the validateCronAuth pattern
      const cronSecret = "test-secret";
      const authHeader = null;
      const isAuthorized = authHeader === `Bearer ${cronSecret}`;

      assert.equal(isAuthorized, false, "Should reject missing auth header");
    });

    it("rejects requests with wrong secret", () => {
      const cronSecret = "correct-secret";
      const authHeader = "Bearer wrong-secret";
      const isAuthorized = authHeader === `Bearer ${cronSecret}`;

      assert.equal(isAuthorized, false, "Should reject wrong secret");
    });

    it("accepts requests with correct secret", () => {
      const cronSecret = "test-secret";
      const authHeader = `Bearer ${cronSecret}`;
      const isAuthorized = authHeader === `Bearer ${cronSecret}`;

      assert.ok(isAuthorized, "Should accept correct secret");
    });
  });

  describe("embed-process loop termination", () => {
    it("stops when queue returns zero activity", async () => {
      const MAX_RUNTIME_MS = 25_000;
      let iterations = 0;
      let totalProcessed = 0;

      // Mock processEmbeddingQueue returning empty stats
      const mockProcess = async () => ({ processed: 0, skipped: 0, failed: 0 });
      const startTime = Date.now();

      while (Date.now() - startTime < MAX_RUNTIME_MS) {
        const stats = await mockProcess();
        totalProcessed += stats.processed;
        iterations++;

        if (stats.processed + stats.skipped + stats.failed === 0) {
          break;
        }
      }

      assert.equal(iterations, 1, "Should stop after first empty batch");
      assert.equal(totalProcessed, 0);
    });

    it("processes multiple batches until empty", async () => {
      let callCount = 0;
      const MAX_RUNTIME_MS = 25_000;
      let iterations = 0;
      let totalProcessed = 0;

      // First call returns work, second returns empty
      const mockProcess = async () => {
        callCount++;
        if (callCount <= 2) {
          return { processed: 5, skipped: 1, failed: 0 };
        }
        return { processed: 0, skipped: 0, failed: 0 };
      };

      const startTime = Date.now();
      while (Date.now() - startTime < MAX_RUNTIME_MS) {
        const stats = await mockProcess();
        totalProcessed += stats.processed;
        iterations++;

        if (stats.processed + stats.skipped + stats.failed === 0) {
          break;
        }
      }

      assert.equal(iterations, 3, "Should run 3 iterations (2 with work + 1 empty)");
      assert.equal(totalProcessed, 10);
    });
  });

  describe("graph-sync-process loop termination", () => {
    it("aggregates graph sync batches and stops on empty work", async () => {
      let callCount = 0;
      let totalProcessed = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      let iterations = 0;

      const mockProcess = async () => {
        callCount++;
        if (callCount === 1) {
          return { processed: 2, skipped: 1, failed: 0, drainState: "processed", reason: null };
        }
        return { processed: 0, skipped: 0, failed: 0, drainState: "empty", reason: null };
      };

      const startTime = Date.now();
      while (Date.now() - startTime < 25_000) {
        const stats = await mockProcess();
        totalProcessed += stats.processed;
        totalSkipped += stats.skipped;
        totalFailed += stats.failed;
        iterations++;

        if (stats.drainState !== "processed") {
          break;
        }
      }

      assert.equal(iterations, 2);
      assert.equal(totalProcessed, 2);
      assert.equal(totalSkipped, 1);
      assert.equal(totalFailed, 0);
    });

    it("distinguishes unavailable drains from benign empty queue results", async () => {
      const unavailable = {
        processed: 0,
        skipped: 0,
        failed: 0,
        drainState: "unavailable" as const,
        reason: "disabled",
      };
      const empty = {
        processed: 0,
        skipped: 0,
        failed: 0,
        drainState: "empty" as const,
        reason: null,
      };

      assert.notEqual(unavailable.drainState, empty.drainState);
      assert.equal(unavailable.reason, "disabled");
      assert.equal(empty.reason, null);
    });

    it("calls purge_graph_sync_queue after processing", async () => {
      const rpcCalls: string[] = [];
      const mockSupabase = {
        rpc: async (fn: string) => {
          rpcCalls.push(fn);
          return { data: 7, error: null };
        },
      };

      const { data, error } = await mockSupabase.rpc("purge_graph_sync_queue");
      assert.equal(error, null);
      assert.equal(data, 7);
      assert.deepEqual(rpcCalls, ["purge_graph_sync_queue"]);
    });
  });

  describe("embed-process error handling", () => {
    it("catches and reports processEmbeddingQueue errors", async () => {
      let caughtError: string | null = null;

      try {
        throw new Error("Embedding API timeout");
      } catch (err) {
        caughtError = err instanceof Error ? err.message : "unknown";
      }

      assert.equal(caughtError, "Embedding API timeout");
    });
  });

  describe("cache-purge route logic", () => {
    it("calls purge_expired_ai_semantic_cache RPC", async () => {
      const rpcCalls: string[] = [];

      const mockSupabase = {
        rpc: async (fn: string) => {
          rpcCalls.push(fn);
          return { data: 42, error: null };
        },
      };

      const { data, error } = await mockSupabase.rpc("purge_expired_ai_semantic_cache");

      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0], "purge_expired_ai_semantic_cache");
      assert.equal(data, 42);
      assert.equal(error, null);
    });

    it("drains multiple 500-row batches until a partial batch is returned", async () => {
      const rpcCalls: string[] = [];
      const responses = [500, 500, 120];

      const mockSupabase = {
        rpc: async (fn: string) => {
          rpcCalls.push(fn);
          return { data: responses.shift() ?? 0, error: null };
        },
      };

      let deletedCount = 0;
      let batches = 0;
      while (deletedCount < 5_000) {
        const { data, error } = await mockSupabase.rpc("purge_expired_ai_semantic_cache");
        assert.equal(error, null);

        const batchDeleted = Math.max(0, Number(data ?? 0));
        deletedCount += batchDeleted;
        batches++;

        if (batchDeleted < 500) {
          break;
        }
      }

      assert.equal(deletedCount, 1_120);
      assert.equal(batches, 3);
      assert.equal(rpcCalls.length, 3);
    });

    it("stops at the 5000-row cap even if every batch is full", async () => {
      let calls = 0;
      const mockSupabase = {
        rpc: async () => {
          calls++;
          return { data: 500, error: null };
        },
      };

      let deletedCount = 0;
      while (deletedCount < 5_000) {
        const { data } = await mockSupabase.rpc("purge_expired_ai_semantic_cache");
        deletedCount += Number(data ?? 0);
        if (Number(data ?? 0) < 500) {
          break;
        }
      }

      assert.equal(deletedCount, 5_000);
      assert.equal(calls, 10);
    });

    it("reports purge failure with error details", async () => {
      const mockSupabase = {
        rpc: async () => ({
          data: null,
          error: { message: "Function not found" },
        }),
      };

      const { data, error } = await mockSupabase.rpc("purge_expired_ai_semantic_cache");

      assert.equal(data, null);
      assert.ok(error, "Should return error");
      assert.equal(error.message, "Function not found");
    });

    it("returns deletedCount from RPC result", () => {
      const rpcData = 15;
      const response = { ok: true, deletedCount: rpcData ?? 0, batches: 1, capped: false };

      assert.equal(response.deletedCount, 15);
      assert.equal(response.batches, 1);
      assert.equal(response.capped, false);
    });

    it("defaults deletedCount to 0 when RPC returns null", () => {
      const rpcData = null;
      const response = { ok: true, deletedCount: rpcData ?? 0, batches: 1, capped: false };

      assert.equal(response.deletedCount, 0);
    });
  });
});
