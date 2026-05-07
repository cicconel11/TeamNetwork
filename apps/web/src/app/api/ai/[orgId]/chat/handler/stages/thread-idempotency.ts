/**
 * Stage 3: thread resolution + idempotency.
 *
 * Consolidates the pre-init blocks formerly inlined in handler.ts:
 *   - thread ownership resolution (`resolveOwnThread`)
 *   - draft-session load (with expired-draft cleanup, history-inferred drafts)
 *   - pending-event action revision context
 *   - route-entity context load (`loadRouteEntityContext`)
 *   - abandoned-stream cleanup (>5 min pending/streaming assistant rows)
 *   - idempotency lookup with replay (hit-complete) and 409 in-progress paths
 *
 * Returns a `StageOutcome` so the orchestrator can short-circuit on:
 *   - thread resolution failure (403/404)
 *   - discussion-thread route entity hard failure (500)
 *   - idempotency lookup error (500)
 *   - idempotency replay (200 SSE) or in-progress (409)
 *   - replay lookup error (500)
 *
 * Stage may mutate `pass1Tools` (drafts narrow tool set) and
 * `usesToolFirstContext` (recomputed after drafts apply).
 */
import { NextResponse } from "next/server";
import type { AiOrgContext } from "@/lib/ai/context";
import type { AiThreadMetadata } from "@/lib/ai/thread-resolver";
import type { resolveOwnThread } from "@/lib/ai/thread-resolver";
import type {
  loadRouteEntityContext,
  RouteEntitySupabase,
} from "@/lib/ai/route-entity-loaders";
import {
  clearDraftSession as clearDraftSessionDefault,
  getDraftSession as getDraftSessionDefault,
  type DraftSessionRecord,
} from "@/lib/ai/draft-sessions";
import { extractRouteEntity } from "@/lib/ai/route-entity";
import {
  INTERRUPTED_ASSISTANT_MESSAGE,
} from "@/lib/ai/assistant-message-display";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import {
  runTimedStage,
  skipStage,
  skipRemainingStages,
  type AiAuditStageTimings,
} from "@/lib/ai/chat-telemetry";
import { createSSEStream, SSE_HEADERS } from "@/lib/ai/sse";
import type { CacheStatus } from "@/lib/ai/sse";
import { shouldContinueDraftSession } from "../draft-session";
import {
  type PendingEventActionRecord,
  type PendingEventRevisionAnalysis,
} from "../pending-event-revision";
import { classifyFastPath } from "../fast-path-classifier";
import { buildSseResponse } from "../sse-runtime";
import type { getPass1Tools } from "../pass1-tools";
import type { StageOutcome, ThreadIdempotencySlice } from "./state";
import { resolveThreadState } from "./resolve-thread-state";

export interface ThreadIdempotencyStageInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  rateLimit: { headers: Record<string, string> | undefined };
  requestLogContext: AiLogContext;
  canUseDraftSessions: boolean;
  stageTimings: AiAuditStageTimings;

  // Slice from validate-policy
  existingThreadId: string | undefined;
  idempotencyKey: string;
  currentPath: string | undefined;
  attachment: unknown;
  messageSafetyPromptSafeMessage: string;
  routing: Parameters<typeof shouldContinueDraftSession>[2];
  usesSharedStaticContext: boolean;
  retrievalReason: string;
  pass1Tools: ReturnType<typeof getPass1Tools>;
  cacheStatus: CacheStatus;
  cacheBypassReason: string | undefined;

  // DI fns
  resolveOwnThreadFn: typeof resolveOwnThread;
  loadRouteEntityContextFn: typeof loadRouteEntityContext;
  getDraftSessionFn: typeof getDraftSessionDefault;
  clearDraftSessionFn: typeof clearDraftSessionDefault;
}

export async function runThreadIdempotencyStage(
  input: ThreadIdempotencyStageInput,
): Promise<StageOutcome<ThreadIdempotencySlice>> {
  const {
    ctx,
    rateLimit,
    requestLogContext,
    canUseDraftSessions,
    stageTimings,
    existingThreadId,
    idempotencyKey,
    currentPath,
    attachment,
    messageSafetyPromptSafeMessage,
    routing,
    usesSharedStaticContext,
    retrievalReason,
    cacheStatus,
    cacheBypassReason,
    resolveOwnThreadFn,
    loadRouteEntityContextFn,
    getDraftSessionFn,
    clearDraftSessionFn,
  } = input;

  let pass1Tools = input.pass1Tools;
  const threadId: string | undefined = existingThreadId;
  let threadMetadata: AiThreadMetadata = {};
  let activeDraftSession: DraftSessionRecord | null = null;
  let activePendingEventActions: PendingEventActionRecord[] = [];
  let pendingEventRevisionAnalysis: PendingEventRevisionAnalysis = { kind: "none" };
  let routeEntityContext: Awaited<ReturnType<typeof loadRouteEntityContext>> | null = null;

  if (threadId) {
    const resolveOutcome = await resolveThreadState({
      ctx,
      threadId,
      rateLimit,
      requestLogContext,
      canUseDraftSessions,
      stageTimings,
      attachment,
      messageSafetyPromptSafeMessage,
      routing,
      pass1Tools,
      resolveOwnThreadFn,
      getDraftSessionFn,
      clearDraftSessionFn,
    });
    if (!resolveOutcome.ok) {
      return resolveOutcome;
    }
    threadMetadata = resolveOutcome.value.threadMetadata;
    activeDraftSession = resolveOutcome.value.activeDraftSession;
    activePendingEventActions = resolveOutcome.value.activePendingEventActions;
    pendingEventRevisionAnalysis = resolveOutcome.value.pendingEventRevisionAnalysis;
    pass1Tools = resolveOutcome.value.pass1Tools;
  } else {
    skipStage(stageTimings, "thread_resolution");
  }

  const usesToolFirstContext = classifyFastPath({
    executionPolicy: { toolPolicy: "none" },
    pass1Tools,
    pass1ToolChoice: undefined,
    activeDraftSession,
    pendingEventRevisionAnalysis,
    pendingConnectionDisambiguation: false,
    attachment,
    retrievalReason,
    usesSharedStaticContext,
    pass1BypassMode: "off",
  }).usesToolFirstContext;

  const routeEntityRef = extractRouteEntity(currentPath);
  if (routeEntityRef) {
    try {
      routeEntityContext = await loadRouteEntityContextFn({
        supabase: ctx.supabase as unknown as RouteEntitySupabase,
        organizationId: ctx.orgId,
        currentPath,
        routeEntity: routeEntityRef,
      });
      if (!routeEntityContext) {
        aiLog("warn", "ai-chat", "route entity context omitted", requestLogContext, {
          currentPath,
          routeEntityKind: routeEntityRef.kind,
        });
      }
    } catch (error) {
      aiLog("error", "ai-chat", "route entity resolution failed", requestLogContext, {
        error,
        currentPath,
        routeEntityKind: routeEntityRef.kind,
      });
      if (routeEntityRef.kind === "discussion_thread") {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Failed to resolve the current discussion thread" },
            { status: 500, headers: rateLimit.headers },
          ),
        };
      }
    }
  }

  // Abandoned stream cleanup (5-min threshold). Fire-and-forget.
  if (existingThreadId) {
    skipStage(stageTimings, "abandoned_stream_cleanup");
    void Promise.resolve(
      ctx.supabase
        .from("ai_messages")
        .update({ status: "error", content: INTERRUPTED_ASSISTANT_MESSAGE })
        .eq("thread_id", existingThreadId)
        .eq("role", "assistant")
        .in("status", ["pending", "streaming"])
        .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    )
      .then(({ error: cleanupError }: { error: unknown }) => {
        if (cleanupError) {
          aiLog("error", "ai-chat", "abandoned stream cleanup failed", {
            ...requestLogContext,
            threadId: existingThreadId,
          }, { error: cleanupError });
        }
      })
      .catch((cleanupError: unknown) => {
        aiLog("error", "ai-chat", "abandoned stream cleanup failed", {
          ...requestLogContext,
          threadId: existingThreadId,
        }, { error: cleanupError });
      });
  } else {
    skipStage(stageTimings, "abandoned_stream_cleanup");
  }

  // Idempotency lookup
  const { data: existingMsg, error: idempError } = await runTimedStage(
    stageTimings,
    "idempotency_lookup",
    async () =>
      ctx.supabase
        .from("ai_messages")
        .select("id, status, thread_id, created_at")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
  );

  if (idempError) {
    aiLog("error", "ai-chat", "idempotency check failed", requestLogContext, {
      error: idempError,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to check message idempotency" },
        { status: 500 },
      ),
    };
  }

  if (existingMsg) {
    if (existingMsg.status === "complete") {
      stageTimings.retrieval = {
        decision: "skip",
        reason: "cache_hit",
      };
      skipRemainingStages(stageTimings, "cache_lookup");

      const { data: assistantReplay, error: assistantReplayError } = await ctx.supabase
        .from("ai_messages")
        .select("content")
        .eq("thread_id", existingMsg.thread_id)
        .eq("role", "assistant")
        .eq("status", "complete")
        .gt("created_at", existingMsg.created_at)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (assistantReplayError) {
        aiLog("error", "ai-chat", "idempotency replay lookup failed", {
          ...requestLogContext,
          threadId: existingMsg.thread_id,
        }, { error: assistantReplayError });
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Failed to replay completed response" },
            { status: 500, headers: rateLimit.headers },
          ),
        };
      }

      if (!assistantReplay?.content) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Request already in progress", threadId: existingMsg.thread_id },
            { status: 409, headers: rateLimit.headers },
          ),
        };
      }

      return {
        ok: false,
        response: buildSseResponse(
          createSSEStream(async (enqueue) => {
            enqueue({ type: "chunk", content: assistantReplay.content });
            enqueue({
              type: "done",
              threadId: existingMsg.thread_id,
              replayed: true,
              cache: {
                status: cacheStatus,
                ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
              },
            });
          }),
          { ...SSE_HEADERS, ...rateLimit.headers },
          existingMsg.thread_id,
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request already in progress", threadId: existingMsg.thread_id },
        { status: 409, headers: rateLimit.headers },
      ),
    };
  }

  return {
    ok: true,
    value: {
      threadId,
      threadMetadata,
      activeDraftSession,
      activePendingEventActions,
      pendingEventRevisionAnalysis,
      routeEntityContext,
      pass1Tools,
      usesToolFirstContext,
    },
  };
}
