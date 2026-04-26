/**
 * Stage: finalize the assistant message + write the audit row.
 *
 * Lifted from the chat handler's SSE `finally` block (model_complete path).
 * Sequence preserved exactly:
 *   1. finalizeAssistantMessage(...) -> update ai_messages row
 *   2. record assistant_finalize_write stage status
 *   3. optional cache write (when policy + state allow)
 *   4. compute requestOutcome + modelRefusal-aware audit error/bypass
 *   5. logAiRequestFn(...) with the full payload
 *
 * The orchestrator passes the live runtime state in directly. cacheEntryId
 * and cacheBypassReason flow through the return value because the orchestrator
 * already emitted `done` before this stage runs — they're audit-only here.
 */
import { setStageStatus, finalizeStageTimings, skipStage, type AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import type { logAiRequest as logAiRequestDefault } from "@/lib/ai/audit";
import type { getZaiModel } from "@/lib/ai/client";
import type { CacheStatus } from "@/lib/ai/sse";
import type { CacheSurface } from "@/lib/ai/semantic-cache-utils";
import type { AiOrgContext } from "@/lib/ai/context";
import type { TurnExecutionPolicy } from "@/lib/ai/turn-execution-policy";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import { finalizeAssistantMessage } from "@/lib/ai/assistant-message-display";
import { writeCache } from "../cache-rag";

type ToolCallAuditEntry = { name: string; args: Record<string, unknown> };
import type { TurnRuntimeState } from "../sse-runtime";

const SCOPE_REFUSAL_CANONICAL_PREFIX = "I can only help with TeamNetwork tasks";

export interface FinalizeAuditInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  threadId: string;
  assistantMessageId: string;
  fullContent: string;
  runtimeState: TurnRuntimeState;
  streamSignal: AbortSignal;
  stageTimings: AiAuditStageTimings;
  executionPolicy: TurnExecutionPolicy;

  cacheStatus: CacheStatus;
  cacheEntryId: string | undefined;
  cacheBypassReason: string | undefined;
  effectiveSurface: CacheSurface;
  promptSafeMessage: string;

  resolvedIntent: string;
  resolvedIntentType: string;
  auditToolCalls: ToolCallAuditEntry[];
  ragChunkCount: number;
  ragTopSimilarity: number | undefined;
  ragError: string | undefined;

  startTime: number;
  requestLogContext: AiLogContext;

  logAiRequestFn: typeof logAiRequestDefault;
  getZaiModelFn: typeof getZaiModel;
}

export async function finalizeTurnAudit(input: FinalizeAuditInput): Promise<void> {
  const finalMessage = finalizeAssistantMessage({
    fullContent: input.fullContent,
    streamCompletedSuccessfully: input.runtimeState.streamCompletedSuccessfully,
    requestAborted: input.streamSignal.aborted,
  });

  const finalizeStartedAt = Date.now();
  const { error: finalizeError } = await input.ctx.supabase
    .from("ai_messages")
    .update({
      content: finalMessage.content,
      status: finalMessage.status,
    })
    .eq("id", input.assistantMessageId);

  setStageStatus(
    input.stageTimings,
    "assistant_finalize_write",
    finalizeError ? "failed" : "completed",
    Date.now() - finalizeStartedAt,
  );

  if (finalizeError) {
    aiLog(
      "error",
      "ai-chat",
      "assistant finalize failed",
      { ...input.requestLogContext, threadId: input.threadId },
      { error: finalizeError, messageId: input.assistantMessageId },
    );
    input.runtimeState.auditErrorMessage ??= "assistant_finalize_failed";
  }

  let cacheEntryId = input.cacheEntryId;
  let cacheBypassReason = input.cacheBypassReason;

  if (
    input.runtimeState.toolCallMade &&
    !cacheBypassReason &&
    input.executionPolicy.cachePolicy === "lookup_exact"
  ) {
    cacheBypassReason = "tool_call_made";
  }

  const canWriteCache =
    input.runtimeState.streamCompletedSuccessfully &&
    !finalizeError &&
    input.executionPolicy.cachePolicy === "lookup_exact" &&
    input.cacheStatus === "miss" &&
    !input.runtimeState.toolCallMade;

  if (canWriteCache) {
    const cacheWriteResult = await writeCache({
      message: input.promptSafeMessage,
      orgId: input.ctx.orgId,
      role: input.ctx.role,
      surface: input.effectiveSurface,
      responseContent: input.fullContent,
      sourceMessageId: input.assistantMessageId,
      supabase: input.ctx.serviceSupabase,
      stageTimings: input.stageTimings,
      logContext: { ...input.requestLogContext, threadId: input.threadId },
    });

    if (cacheWriteResult.status === "inserted") {
      cacheEntryId = cacheWriteResult.entryId;
    } else if (!cacheBypassReason) {
      cacheBypassReason = cacheWriteResult.bypassReason;
    }
  } else {
    skipStage(input.stageTimings, "cache_write");
  }

  const requestOutcome = input.runtimeState.streamCompletedSuccessfully
    ? input.runtimeState.auditErrorMessage === "tool_grounding_failed"
      ? "tool_grounding_fallback"
      : "completed"
    : input.streamSignal.aborted
      ? "aborted"
      : input.runtimeState.auditErrorMessage?.includes("timeout")
        ? "timed_out"
        : "error";

  const modelRefusalDetected =
    input.fullContent.trim().startsWith(SCOPE_REFUSAL_CANONICAL_PREFIX);
  const finalBypassReason = modelRefusalDetected
    ? cacheBypassReason ?? "scope_refusal"
    : cacheBypassReason;
  const finalAuditError = modelRefusalDetected
    ? input.runtimeState.auditErrorMessage ?? "scope_refusal:model_refusal_detected"
    : input.runtimeState.auditErrorMessage;

  if (input.runtimeState.timeToFirstEventMs !== undefined) {
    input.stageTimings.request.time_to_first_event_ms =
      input.runtimeState.timeToFirstEventMs;
  }

  await input.logAiRequestFn(
    input.ctx.serviceSupabase,
    {
      threadId: input.threadId,
      messageId: input.assistantMessageId,
      userId: input.ctx.userId,
      orgId: input.ctx.orgId,
      intent: input.resolvedIntent,
      intentType: input.resolvedIntentType,
      toolCalls: input.auditToolCalls.length > 0 ? input.auditToolCalls : undefined,
      latencyMs: Date.now() - input.startTime,
      model: process.env.ZAI_API_KEY ? input.getZaiModelFn() : undefined,
      inputTokens: input.runtimeState.usage?.inputTokens,
      outputTokens: input.runtimeState.usage?.outputTokens,
      error: finalAuditError,
      cacheStatus: input.cacheStatus,
      cacheEntryId,
      cacheBypassReason: finalBypassReason,
      contextSurface: (input.runtimeState.contextMetadata?.surface ?? input.effectiveSurface) as CacheSurface,
      contextTokenEstimate: input.runtimeState.contextMetadata?.estimatedTokens,
      ragChunkCount: input.ragChunkCount > 0 ? input.ragChunkCount : undefined,
      ragTopSimilarity: input.ragTopSimilarity,
      ragError: input.ragError,
      safetyVerdict: input.runtimeState.safetyVerdict,
      safetyCategories: input.runtimeState.safetyCategories,
      safetyLatencyMs: input.runtimeState.safetyLatencyMs,
      ragGrounded: input.runtimeState.ragGrounded,
      ragGroundingFailures: input.runtimeState.ragGroundingFailures,
      ragGroundingLatencyMs: input.runtimeState.ragGroundingLatencyMs,
      ragGroundingMode: input.runtimeState.ragGroundingAudited,
      stageTimings: finalizeStageTimings(
        input.stageTimings,
        requestOutcome,
        Date.now() - input.startTime,
      ),
    },
    { ...input.requestLogContext, threadId: input.threadId },
  );
}
