/**
 * Stage wrapper around `handler/cache-rag.ts` for the chat handler pipeline.
 *
 * Owns the lookup decision logic at both call sites and consolidates the
 * cache-hit short-circuit (insert assistant complete row + audit + SSE) into
 * a single helper. The orchestrator drives:
 *   - `runPreInitCacheLookup` BEFORE init_ai_chat (fresh thread, no risk)
 *   - `runPostInitCacheLookup` AFTER init_ai_chat (existing thread or
 *     pre-init not eligible)
 *   - `serveCacheHit` once init_ai_chat resolves and a cache hit can be
 *     persisted and replayed.
 *
 * Each function returns either a slice update (cacheStatus / cacheEntryId /
 * cacheBypassReason) or — for the hit path — a `Response` the orchestrator
 * returns directly.
 */
import type { CacheStatus } from "@/lib/ai/sse";
import type { CacheSurface } from "@/lib/ai/semantic-cache-utils";
import type { logAiRequest as logAiRequestDefault } from "@/lib/ai/audit";
import {
  finalizeStageTimings,
  skipStage,
  skipRemainingStages,
  type AiAuditStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { createSSEStream, SSE_HEADERS } from "@/lib/ai/sse";
import type { AiOrgContext } from "@/lib/ai/context";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import { checkCache } from "../cache-rag";
import { buildSseResponse } from "../sse-runtime";

interface AssistantInserter {
  (input: { content: string | null; status: "pending" | "complete" }): Promise<{
    data: { id: string } | null;
    error: unknown;
  }>;
}

export interface PreInitCacheLookupInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  cacheDisabled: boolean;
  executionPolicy: TurnExecutionPolicy;
  existingThreadId: string | undefined;
  messageSafetyRiskLevel: "none" | string;
  promptSafeMessage: string;
  effectiveSurface: CacheSurface;
  stageTimings: AiAuditStageTimings;
  requestLogContext: AiLogContext;
}

export interface PreInitCacheLookupResult {
  performed: boolean;
  /** Set when a hit was buffered for post-init replay. */
  hit?: { id: string; responseContent: string };
  /** Updated cacheStatus on miss / error (undefined when nothing changed). */
  cacheStatus?: CacheStatus;
  cacheBypassReason?: string;
}

/**
 * Pre-init cache lookup: only fires for fresh threads with no safety risk and
 * a `lookup_exact` execution policy. Pure read — caller defers SSE until
 * after `init_ai_chat`.
 */
export async function runPreInitCacheLookup(
  input: PreInitCacheLookupInput,
): Promise<PreInitCacheLookupResult> {
  const eligible =
    !input.cacheDisabled &&
    input.executionPolicy.cachePolicy === "lookup_exact" &&
    !input.existingThreadId &&
    input.messageSafetyRiskLevel === "none";

  if (!eligible) return { performed: false };

  const cacheResult = await checkCache({
    message: input.promptSafeMessage,
    orgId: input.ctx.orgId,
    role: input.ctx.role,
    surface: input.effectiveSurface,
    supabase: input.ctx.serviceSupabase,
    stageTimings: input.stageTimings,
    logContext: input.requestLogContext,
  });

  if (cacheResult.status === "hit") {
    return {
      performed: true,
      hit: {
        id: cacheResult.hit.id,
        responseContent: cacheResult.hit.responseContent,
      },
    };
  }

  return {
    performed: true,
    cacheStatus: cacheResult.status === "miss" ? "miss" : "error",
    cacheBypassReason: cacheResult.status === "error" ? "cache_lookup_failed" : undefined,
  };
}

export interface ServeCacheHitInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  threadId: string;
  cacheEntryId: string;
  responseContent: string;
  effectiveSurface: CacheSurface;
  resolvedIntent: string;
  resolvedIntentType: string;
  startTime: number;
  stageTimings: AiAuditStageTimings;
  rateLimit: { headers: Record<string, string> | undefined };
  requestLogContext: AiLogContext;
  insertAssistantMessage: AssistantInserter;
  logAiRequestFn: typeof logAiRequestDefault;
}

export type ServeCacheHitOutcome =
  | { kind: "served"; response: Response }
  | { kind: "persist_failed"; cacheStatus: CacheStatus; cacheBypassReason: string };

/**
 * Persist the cached assistant message, audit, and stream the SSE replay.
 * Used by both pre-init and post-init hit paths so the audit + ordering stays
 * identical.
 */
export async function serveCacheHit(
  input: ServeCacheHitInput,
): Promise<ServeCacheHitOutcome> {
  const { data: cachedAssistantMsg, error: cachedAssistantError } =
    await input.insertAssistantMessage({
      content: input.responseContent,
      status: "complete",
    });

  if (cachedAssistantError || !cachedAssistantMsg) {
    aiLog("error", "ai-chat", "cache hit assistant message failed", {
      ...input.requestLogContext,
      threadId: input.threadId,
    }, { error: cachedAssistantError });
    return {
      kind: "persist_failed",
      cacheStatus: "error",
      cacheBypassReason: "cache_hit_persist_failed",
    };
  }

  stageTimingsMarkCacheHit(input.stageTimings);

  const cachedStream = createSSEStream(async (enqueue) => {
    enqueue({ type: "chunk", content: input.responseContent });
    enqueue({
      type: "done",
      threadId: input.threadId,
      replayed: true,
      cache: { status: "hit_exact", entryId: input.cacheEntryId },
    });
  });

  await input.logAiRequestFn(input.ctx.serviceSupabase, {
    threadId: input.threadId,
    messageId: cachedAssistantMsg.id,
    userId: input.ctx.userId,
    orgId: input.ctx.orgId,
    intent: input.resolvedIntent,
    intentType: input.resolvedIntentType,
    latencyMs: Date.now() - input.startTime,
    cacheStatus: "hit_exact",
    cacheEntryId: input.cacheEntryId,
    contextSurface: input.effectiveSurface,
    stageTimings: finalizeStageTimings(input.stageTimings, "cache_hit", Date.now() - input.startTime),
  }, {
    ...input.requestLogContext,
    threadId: input.threadId,
  });

  return {
    kind: "served",
    response: buildSseResponse(
      cachedStream,
      { ...SSE_HEADERS, ...input.rateLimit.headers },
      input.threadId,
    ),
  };
}

function stageTimingsMarkCacheHit(stageTimings: AiAuditStageTimings): void {
  stageTimings.retrieval = { decision: "skip", reason: "cache_hit" };
  skipRemainingStages(stageTimings, "rag_retrieval");
}

export interface PostInitCacheLookupInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  threadId: string;
  cacheDisabled: boolean;
  executionPolicy: TurnExecutionPolicy;
  preInitCacheLookupPerformed: boolean;
  promptSafeMessage: string;
  effectiveSurface: CacheSurface;
  resolvedIntent: string;
  resolvedIntentType: string;
  startTime: number;
  stageTimings: AiAuditStageTimings;
  rateLimit: { headers: Record<string, string> | undefined };
  requestLogContext: AiLogContext;
  insertAssistantMessage: AssistantInserter;
  logAiRequestFn: typeof logAiRequestDefault;
}

export type PostInitCacheLookupOutcome =
  | { kind: "served"; response: Response; cacheEntryId: string }
  | { kind: "miss"; cacheStatus: CacheStatus; cacheBypassReason?: string }
  | { kind: "persist_failed"; cacheStatus: CacheStatus; cacheBypassReason: string }
  | { kind: "skipped" };

/**
 * Post-init cache lookup. Only runs when pre-init did not run AND policy is
 * `lookup_exact` AND not disabled. On hit -> serves the response and returns
 * `served`. On miss -> caller updates cacheStatus accordingly. On
 * persist-failure -> caller continues with the live model path.
 */
export async function runPostInitCacheLookup(
  input: PostInitCacheLookupInput,
): Promise<PostInitCacheLookupOutcome> {
  const eligible =
    !input.preInitCacheLookupPerformed &&
    !input.cacheDisabled &&
    input.executionPolicy.cachePolicy === "lookup_exact";

  if (!eligible) {
    if (!input.preInitCacheLookupPerformed) {
      skipStage(input.stageTimings, "cache_lookup");
    }
    return { kind: "skipped" };
  }

  const cacheResult = await checkCache({
    message: input.promptSafeMessage,
    orgId: input.ctx.orgId,
    role: input.ctx.role,
    surface: input.effectiveSurface,
    supabase: input.ctx.serviceSupabase,
    stageTimings: input.stageTimings,
    logContext: { ...input.requestLogContext, threadId: input.threadId },
  });

  if (cacheResult.status === "hit") {
    const served = await serveCacheHit({
      ctx: input.ctx,
      threadId: input.threadId,
      cacheEntryId: cacheResult.hit.id,
      responseContent: cacheResult.hit.responseContent,
      effectiveSurface: input.effectiveSurface,
      resolvedIntent: input.resolvedIntent,
      resolvedIntentType: input.resolvedIntentType,
      startTime: input.startTime,
      stageTimings: input.stageTimings,
      rateLimit: input.rateLimit,
      requestLogContext: input.requestLogContext,
      insertAssistantMessage: input.insertAssistantMessage,
      logAiRequestFn: input.logAiRequestFn,
    });
    if (served.kind === "served") {
      return {
        kind: "served",
        response: served.response,
        cacheEntryId: cacheResult.hit.id,
      };
    }
    return served;
  }

  return {
    kind: "miss",
    cacheStatus: cacheResult.status === "miss" ? "miss" : "error",
    cacheBypassReason: cacheResult.status === "error" ? "cache_lookup_failed" : undefined,
  };
}

// Re-export skipStage helper so the orchestrator does not need a separate
// import path for this (cleaner seam ownership).
export { skipStage };
