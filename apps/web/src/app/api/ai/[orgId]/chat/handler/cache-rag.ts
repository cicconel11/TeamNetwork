/**
 * Cache + RAG orchestration helpers for the chat handler.
 *
 * Decision: a single `checkCache` function covers both the pre-init (thread-less)
 * and post-init (thread-bound) lookup sites. The underlying lookup is identical;
 * only the log context differs and that is passed in by the caller. The two call
 * sites differ in what they *do* with a hit (pre-init defers SSE until after
 * `init_ai_chat`; post-init persists + streams immediately), so the caller retains
 * that branching. `verifyRagGrounding` is NOT extracted here — it runs inside the
 * SSE runtime's `applyRagGrounding` closure and is owned by U6.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSemanticCacheKeyParts,
  type CacheSurface,
} from "@/lib/ai/semantic-cache-utils";
import {
  lookupSemanticCache,
  writeCacheEntry,
} from "@/lib/ai/semantic-cache";
import { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import type { RagChunkInput } from "@/lib/ai/context-builder";
import {
  runTimedStage,
  skipStage,
  type AiAuditStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";

// ---------------------------------------------------------------------------
// checkCache
// ---------------------------------------------------------------------------

export type CacheCheckResult =
  | { status: "hit"; hit: { id: string; responseContent: string } }
  | { status: "miss" }
  | { status: "error" };

/**
 * Wraps buildSemanticCacheKeyParts + a timed lookupSemanticCache call.
 *
 * Caller is responsible for:
 * - deciding whether to perform the lookup (eligibility / policy gates)
 * - mapping the result onto {cacheStatus, cacheBypassReason, cacheEntryId}
 * - deferring or issuing the SSE response on hit
 */
export async function checkCache(args: {
  message: string;
  orgId: string;
  role: string;
  surface: CacheSurface;
  supabase: SupabaseClient;
  stageTimings: AiAuditStageTimings;
  logContext: AiLogContext;
}): Promise<CacheCheckResult> {
  const cacheKey = buildSemanticCacheKeyParts({
    message: args.message,
    orgId: args.orgId,
    role: args.role,
  });

  const lookupStart = Date.now();
  const cacheResult = await runTimedStage(
    args.stageTimings,
    "cache_lookup",
    async () =>
      lookupSemanticCache({
        cacheKey,
        orgId: args.orgId,
        surface: args.surface,
        supabase: args.supabase,
        logContext: args.logContext,
      })
  );
  const durationMs = Date.now() - lookupStart;

  const status: "hit" | "miss" | "error" = cacheResult.ok
    ? "hit"
    : cacheResult.reason === "miss"
      ? "miss"
      : "error";

  // Hit-rate observability. No prompt, no hash — only status + surface.
  aiLog("info", "ai-cache", "lookup", args.logContext, {
    event: "lookup",
    status,
    surface: args.surface,
    durationMs,
  });

  if (cacheResult.ok) {
    return {
      status: "hit",
      hit: {
        id: cacheResult.hit.id,
        responseContent: cacheResult.hit.responseContent,
      },
    };
  }

  return cacheResult.reason === "miss"
    ? { status: "miss" }
    : { status: "error" };
}

// ---------------------------------------------------------------------------
// retrieveRag
// ---------------------------------------------------------------------------

export interface RagRetrievalResult {
  chunks: RagChunkInput[];
  chunkCount: number;
  topSimilarity: number | undefined;
  error: string | undefined;
}

/**
 * Wraps the RAG retrieval block with its stage timing + error handling.
 *
 * Returns an empty result (no throw) on failure so the caller can continue
 * without RAG context, matching the prior inline behavior.
 */
export async function retrieveRag(args: {
  retrieveRelevantChunksFn: typeof retrieveRelevantChunks;
  query: string;
  orgId: string;
  spendBypass: boolean;
  serviceSupabase: SupabaseClient;
  stageTimings: AiAuditStageTimings;
  logContext: AiLogContext;
}): Promise<RagRetrievalResult> {
  try {
    const retrieved = await runTimedStage(
      args.stageTimings,
      "rag_retrieval",
      async () =>
        args.retrieveRelevantChunksFn({
          query: args.query,
          orgId: args.orgId,
          spendBypass: args.spendBypass,
          serviceSupabase: args.serviceSupabase,
          logContext: args.logContext,
        })
    );

    if (retrieved.length === 0) {
      return { chunks: [], chunkCount: 0, topSimilarity: undefined, error: undefined };
    }

    return {
      chunks: retrieved.map((c) => ({
        contentText: c.contentText,
        sourceTable: c.sourceTable,
        metadata: c.metadata,
      })),
      chunkCount: retrieved.length,
      topSimilarity: Math.max(...retrieved.map((c) => c.similarity)),
      error: undefined,
    };
  } catch (err) {
    aiLog(
      "error",
      "ai-chat",
      "RAG retrieval failed (continuing without)",
      args.logContext,
      { error: err }
    );
    return {
      chunks: [],
      chunkCount: 0,
      topSimilarity: undefined,
      error: err instanceof Error ? err.message : "rag_retrieval_failed",
    };
  }
}

/**
 * Mark the rag_retrieval stage as skipped; the caller uses this when retrieval
 * is disabled (no embedding key) or policy-skipped.
 */
export function skipRagStage(stageTimings: AiAuditStageTimings): void {
  skipStage(stageTimings, "rag_retrieval");
}

// ---------------------------------------------------------------------------
// writeCache
// ---------------------------------------------------------------------------

export type CacheWriteOutcome =
  | { status: "inserted"; entryId: string }
  | { status: "duplicate"; bypassReason: "cache_write_duplicate" }
  | { status: "skipped_too_large"; bypassReason: "cache_write_skipped_too_large" }
  | { status: "error"; bypassReason: "cache_write_failed" };

/**
 * Wraps writeCacheEntry with the stage timer + error funnel used at handler exit.
 *
 * Caller still decides cache-write eligibility (policy, tool calls, stream
 * completion). This function assumes the caller already decided "write", it
 * just performs the write under a stage timer and normalizes the outcome.
 */
export async function writeCache(args: {
  message: string;
  orgId: string;
  role: string;
  surface: CacheSurface;
  responseContent: string;
  sourceMessageId: string;
  supabase: SupabaseClient;
  stageTimings: AiAuditStageTimings;
  logContext: AiLogContext;
}): Promise<CacheWriteOutcome> {
  const cacheKey = buildSemanticCacheKeyParts({
    message: args.message,
    orgId: args.orgId,
    role: args.role,
  });

  try {
    const result = await runTimedStage(
      args.stageTimings,
      "cache_write",
      async () => {
        const inner = await writeCacheEntry({
          cacheKey,
          responseContent: args.responseContent,
          orgId: args.orgId,
          surface: args.surface,
          sourceMessageId: args.sourceMessageId,
          supabase: args.supabase,
          logContext: args.logContext,
        });

        if (inner.status === "error") {
          throw new Error("cache_write_failed");
        }

        return inner;
      }
    );

    if (result.status === "inserted") {
      aiLog("info", "ai-cache", "write", args.logContext, {
        event: "write",
        surface: args.surface,
        entryId: result.entryId,
      });
      return { status: "inserted", entryId: result.entryId };
    }
    if (result.status === "duplicate") {
      return { status: "duplicate", bypassReason: "cache_write_duplicate" };
    }
    // skipped_too_large — "error" already thrown above.
    return {
      status: "skipped_too_large",
      bypassReason: "cache_write_skipped_too_large",
    };
  } catch (error) {
    aiLog("error", "ai-chat", "cache write failed", args.logContext, {
      error,
      messageId: args.sourceMessageId,
    });
    return { status: "error", bypassReason: "cache_write_failed" };
  }
}
