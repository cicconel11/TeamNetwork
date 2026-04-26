/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { buildPromptContext } from "@/lib/ai/context-builder";
import {
  composeResponse,
  type ToolResultMessage,
} from "@/lib/ai/response-composer";
import { logAiRequest } from "@/lib/ai/audit";
import { createSSEStream, SSE_HEADERS } from "@/lib/ai/sse";
import {
  AI_TOOL_MAP,
  type ToolName,
} from "@/lib/ai/tools/definitions";
import {
  executeToolCall,
  getToolAuthorizationMode,
  type ToolExecutionAuthorization,
} from "@/lib/ai/tools/executor";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import {
  buildTurnExecutionPolicy,
} from "@/lib/ai/turn-execution-policy";
import { loadRouteEntityContext } from "@/lib/ai/route-entity-loaders";
import {
  verifyToolBackedResponse,
  type SuccessfulToolSummary,
} from "@/lib/ai/grounding/tool/verifier";
import {
  classifySafety,
} from "@/lib/ai/safety-gate";
import {
  verifyRagGrounding,
  type RagGroundingMode,
} from "@/lib/ai/grounding/rag";
import { trackOpsEventServer } from "@/lib/analytics/events-server";
import {
  sanitizeHistoryMessageForPrompt,
} from "@/lib/ai/message-safety";
import {
  clearDraftSession,
  getDraftSession,
  saveDraftSession,
} from "@/lib/ai/draft-sessions";
import {
  createStageTimings,
  skipStage,
  addToolCallTiming,
} from "@/lib/ai/chat-telemetry";
import { aiLog } from "@/lib/ai/logger";
import {
  hasPendingConnectionDisambiguation,
  looksLikeConnectionDisambiguationReply,
  collectPhoneNumberFields,
  formatDeterministicToolResponse,
  formatDeterministicToolErrorResponse,
  formatRevisedPendingEventResponse,
  resolveHideDonorNamesPreference,
  resolveOrgSlug,
  CONNECTION_PASS2_TEMPLATE,
} from "./handler/formatters/index";
import {
  MEMBER_ROSTER_PROMPT_PATTERN,
  getForcedPass1ToolChoice,
} from "./handler/pass1-tools";
import {
  buildDraftSessionContextMessage,
  mergeDraftPayload,
} from "./handler/draft-session";
import {
  buildPrepareEventArgsFromPendingAction,
  getPendingActionFromToolData,
  SUPPORTED_EVENT_TYPE_LABELS,
} from "./handler/pending-event-revision";
import {
  ACTIVE_DRAFT_CONTINUATION_INSTRUCTION,
  CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION,
  EMPTY_ASSISTANT_RESPONSE_FALLBACK,
  MEMBER_LIST_PASS2_INSTRUCTION,
  MENTOR_PASS2_TEMPLATE,
  applyRagGrounding,
  applySafetyGate,
  buildSseResponse,
  createTurnRuntimeState,
  recordTurnUsage,
} from "./handler/sse-runtime";

export {
  CONNECTION_PASS2_TEMPLATE,
  collectPhoneNumberFields,
  formatSuggestConnectionsResponse,
} from "./handler/formatters/index";
export type { ChatAttachment } from "./handler/shared";
import type { ChatRouteDeps } from "./handler-types";
export type { ChatRouteDeps } from "./handler-types";
import { runAuthContextStage } from "./handler/stages/auth-context";
import { runValidatePolicyStage } from "./handler/stages/validate-policy";
import { runThreadIdempotencyStage } from "./handler/stages/thread-idempotency";
import {
  runPreInitCacheLookup,
  runPostInitCacheLookup,
  serveCacheHit,
} from "./handler/stages/cache-rag-stage";
import { runInitChatRpcStage } from "./handler/stages/init-chat-rpc";
import { runInitChatHistoryStage } from "./handler/stages/init-chat-history";
import { serveTerminalRefusal } from "./handler/stages/serve-terminal-refusal";
import { runRagRetrievalStage } from "./handler/stages/rag-retrieval-stage";
import { runAssistantPlaceholderStage } from "./handler/stages/assistant-placeholder";
import { runPass1 } from "./handler/stages/run-pass1";
import { runPass2 } from "./handler/stages/run-pass2";
import { runGroundingCheck } from "./handler/stages/run-grounding-check";
import { createToolCallHandler } from "./handler/stages/run-tool-calls";
import { finalizeTurnAudit } from "./handler/stages/finalize-audit";

const MESSAGE_SAFETY_FALLBACK =
  "I can’t help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your organization’s data instead.";

const SCOPE_REFUSAL_FALLBACK =
  "I can only help with TeamNetwork tasks for your organization — like members, events, announcements, discussions, jobs, donations, or finding the right page. That request is outside what I do.";

export function createChatPostHandler(deps: ChatRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const buildPromptContextFn = deps.buildPromptContext ?? buildPromptContext;
  const createZaiClientFn = deps.createZaiClient ?? createZaiClient;
  const getZaiModelFn = deps.getZaiModel ?? getZaiModel;
  const composeResponseFn = deps.composeResponse ?? composeResponse;
  const logAiRequestFn = deps.logAiRequest ?? logAiRequest;
  const resolveOwnThreadFn = deps.resolveOwnThread ?? resolveOwnThread;
  const retrieveRelevantChunksFn = deps.retrieveRelevantChunks ?? retrieveRelevantChunks;
  const executeToolCallFn = deps.executeToolCall ?? executeToolCall;
  const buildTurnExecutionPolicyFn =
    deps.buildTurnExecutionPolicy ?? buildTurnExecutionPolicy;
  const verifyToolBackedResponseFn =
    deps.verifyToolBackedResponse ?? verifyToolBackedResponse;
  const classifySafetyFn = deps.classifySafety ?? classifySafety;
  const verifyRagGroundingFn = deps.verifyRagGrounding ?? verifyRagGrounding;
  const trackOpsEventServerFn = deps.trackOpsEventServer ?? trackOpsEventServer;
  const getDraftSessionFn = deps.getDraftSession ?? getDraftSession;
  const saveDraftSessionFn = deps.saveDraftSession ?? saveDraftSession;
  const clearDraftSessionFn = deps.clearDraftSession ?? clearDraftSession;
  const loadRouteEntityContextFn = deps.loadRouteEntityContext ?? loadRouteEntityContext;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const stageTimings = createStageTimings(requestId);

    // Stage 1: auth + org context
    const authOutcome = await runAuthContextStage({
      request,
      orgId,
      requestId,
      stageTimings,
      createClientFn,
      getAiOrgContextFn,
      draftSessionDeps: {
        getDraftSession: deps.getDraftSession,
        saveDraftSession: deps.saveDraftSession,
        clearDraftSession: deps.clearDraftSession,
      },
    });
    if (!authOutcome.ok) return authOutcome.response;
    const {
      ctx,
      rateLimit,
      canUseDraftSessions,
      requestLogContext,
      cacheDisabled,
    } = authOutcome.value;

    // Stage 2: validate body + build execution policy
    const policyOutcome = await runValidatePolicyStage({
      request,
      ctx,
      rateLimit,
      cacheDisabled,
      stageTimings,
      buildTurnExecutionPolicyFn,
    });
    if (!policyOutcome.ok) return policyOutcome.response;

    const {
      message,
      surface,
      existingThreadId,
      idempotencyKey,
      currentPath,
      attachment,
      messageSafety,
      routing,
      effectiveSurface,
      resolvedIntent,
      resolvedIntentType,
      executionPolicy,
      usesSharedStaticContext,
    } = policyOutcome.value;
    let { pass1Tools, cacheStatus, cacheEntryId, cacheBypassReason } =
      policyOutcome.value;

    const requestNow = new Date().toISOString();
    const requestTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const skipRagRetrieval = executionPolicy.retrieval.mode === "skip";

    // Stage 3: thread resolution + draft + route entity + abandoned cleanup + idempotency
    const threadOutcome = await runThreadIdempotencyStage({
      ctx,
      rateLimit,
      requestLogContext,
      canUseDraftSessions,
      stageTimings,
      existingThreadId,
      idempotencyKey,
      currentPath,
      attachment,
      messageSafetyPromptSafeMessage: messageSafety.promptSafeMessage,
      routing,
      usesSharedStaticContext,
      retrievalReason: executionPolicy.retrieval.reason,
      pass1Tools,
      cacheStatus,
      cacheBypassReason,
      resolveOwnThreadFn,
      loadRouteEntityContextFn,
      getDraftSessionFn,
      clearDraftSessionFn,
    });
    if (!threadOutcome.ok) return threadOutcome.response;
    let threadId: string | undefined = threadOutcome.value.threadId;
    const threadMetadata = threadOutcome.value.threadMetadata;
    let activeDraftSession = threadOutcome.value.activeDraftSession;
    const activePendingEventActions = threadOutcome.value.activePendingEventActions;
    const pendingEventRevisionAnalysis = threadOutcome.value.pendingEventRevisionAnalysis;
    const routeEntityContext = threadOutcome.value.routeEntityContext;
    pass1Tools = threadOutcome.value.pass1Tools;
    const usesToolFirstContext = threadOutcome.value.usesToolFirstContext;

    const preInitLookup = await runPreInitCacheLookup({
      ctx,
      cacheDisabled,
      executionPolicy,
      existingThreadId,
      messageSafetyRiskLevel: messageSafety.riskLevel,
      promptSafeMessage: messageSafety.promptSafeMessage,
      effectiveSurface,
      stageTimings,
      requestLogContext,
    });
    const preInitCacheLookupPerformed = preInitLookup.performed;
    const preInitCacheHit = preInitLookup.hit;
    if (preInitLookup.cacheStatus) cacheStatus = preInitLookup.cacheStatus;
    if (preInitLookup.cacheBypassReason) cacheBypassReason = preInitLookup.cacheBypassReason;

    // 7+8. Atomically create/reuse thread and insert user message via RPC
    const initOutcome = await runInitChatRpcStage({
      ctx,
      rateLimit,
      stageTimings,
      requestLogContext,
      surface,
      message,
      idempotencyKey,
      threadId,
      resolvedIntent,
      resolvedIntentType,
      effectiveSurface,
    });
    if (!initOutcome.ok) return initOutcome.response;
    threadId = initOutcome.value.threadId;
    const insertAssistantMessage = initOutcome.value.insertAssistantMessage;

    if (messageSafety.riskLevel !== "none") {
      cacheStatus = "bypass";
      cacheBypassReason = `message_safety_${messageSafety.riskLevel}`;
      return serveTerminalRefusal({
        kind: "message_safety",
        ctx,
        threadId: threadId!,
        fallbackContent: MESSAGE_SAFETY_FALLBACK,
        auditErrorCode: `message_safety_${messageSafety.riskLevel}:${messageSafety.reasons.join(",")}`,
        opsEndpointGroup: "ai-safety",
        opsErrorCode: `message_safety_${messageSafety.riskLevel}`,
        finalizeReason: "message_safety_blocked",
        retrievalReason: "message_safety_blocked",
        cacheStatus,
        cacheBypassReason,
        effectiveSurface,
        resolvedIntent,
        resolvedIntentType,
        startTime,
        stageTimings,
        rateLimit,
        requestLogContext,
        insertAssistantMessage,
        logAiRequestFn,
        trackOpsEventServerFn,
      });
    }

    if (executionPolicy.profile === "out_of_scope_unrelated") {
      const refusalReason =
        executionPolicy.reasons[0]?.replace(/^out_of_scope_/, "") ??
        "unrelated_pattern";
      cacheStatus = "bypass";
      cacheBypassReason = "scope_refusal";
      return serveTerminalRefusal({
        kind: "scope_refusal",
        ctx,
        threadId: threadId!,
        fallbackContent: SCOPE_REFUSAL_FALLBACK,
        auditErrorCode: `scope_refusal:${refusalReason}`,
        opsEndpointGroup: "ai-scope",
        opsErrorCode: `scope_refusal_${refusalReason}`,
        finalizeReason: "out_of_scope_request",
        retrievalReason: "out_of_scope_request",
        cacheStatus,
        cacheBypassReason,
        effectiveSurface,
        resolvedIntent,
        resolvedIntentType,
        startTime,
        stageTimings,
        rateLimit,
        requestLogContext,
        insertAssistantMessage,
        logAiRequestFn,
        trackOpsEventServerFn,
      });
    }

    if (preInitCacheHit) {
      const served = await serveCacheHit({
        ctx,
        threadId: threadId!,
        cacheEntryId: preInitCacheHit.id,
        responseContent: preInitCacheHit.responseContent,
        effectiveSurface,
        resolvedIntent,
        resolvedIntentType,
        startTime,
        stageTimings,
        rateLimit,
        requestLogContext,
        insertAssistantMessage,
        logAiRequestFn,
      });
      if (served.kind === "served") {
        cacheStatus = "hit_exact";
        cacheEntryId = preInitCacheHit.id;
        return served.response;
      }
      cacheStatus = served.cacheStatus;
      cacheBypassReason = served.cacheBypassReason;
    }

    const postInit = await runPostInitCacheLookup({
      ctx,
      threadId: threadId!,
      cacheDisabled,
      executionPolicy,
      preInitCacheLookupPerformed,
      promptSafeMessage: messageSafety.promptSafeMessage,
      effectiveSurface,
      resolvedIntent,
      resolvedIntentType,
      startTime,
      stageTimings,
      rateLimit,
      requestLogContext,
      insertAssistantMessage,
      logAiRequestFn,
    });
    if (postInit.kind === "served") {
      cacheStatus = "hit_exact";
      cacheEntryId = postInit.cacheEntryId;
      return postInit.response;
    }
    if (postInit.kind === "miss" || postInit.kind === "persist_failed") {
      cacheStatus = postInit.cacheStatus;
      if (postInit.cacheBypassReason) cacheBypassReason = postInit.cacheBypassReason;
    }

    const ragSlice = await runRagRetrievalStage({
      ctx,
      threadId: threadId!,
      promptSafeMessage: messageSafety.promptSafeMessage,
      skipRagRetrieval,
      hasEmbeddingKey: !!process.env.EMBEDDING_API_KEY,
      executionPolicy,
      stageTimings,
      requestLogContext,
      retrieveRelevantChunksFn,
    });
    const ragChunks = ragSlice.ragChunks;
    const ragChunkCount = ragSlice.ragChunkCount;
    const ragTopSimilarity = ragSlice.ragTopSimilarity;
    const ragError = ragSlice.ragError;

    const placeholderOutcome = await runAssistantPlaceholderStage({
      threadId: threadId!,
      rateLimit,
      stageTimings,
      requestLogContext,
      insertAssistantMessage,
    });
    if (!placeholderOutcome.ok) return placeholderOutcome.response;
    const assistantMessageId = placeholderOutcome.value.assistantMessageId;

    // 10–12. Stream SSE response
    const stream = createSSEStream(async (enqueue, streamSignal) => {
      let fullContent = "";
      let pass1BufferedContent = "";
      let pass2BufferedContent = "";
      const runtimeState = createTurnRuntimeState();
      const safetyGateDisabled = process.env.DISABLE_SAFETY_GATE === "1";
      const safetyGateShadow = process.env.SAFETY_GATE_SHADOW === "1";
      const ragGroundingDisabled = process.env.DISABLE_RAG_GROUNDING === "1";
      const ragGroundingMode: RagGroundingMode =
        (process.env.RAG_GROUNDING_MODE as RagGroundingMode) || "shadow";
      const ragGroundingMinChunks = Number.parseInt(
        process.env.RAG_GROUNDING_MIN_CHUNKS ?? "1",
        10
      );
      let terminateTurn = false;
      let toolPassBreakerOpen = false;
      const auditToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const successfulToolResults: SuccessfulToolSummary[] = [];
      const applyTurnSafetyGate = (buffered: string) =>
        applySafetyGate({
          buffered,
          disabled: safetyGateDisabled,
          shadow: safetyGateShadow,
          ragChunks,
          successfulToolResults,
          classifySafetyFn,
          trackOpsEventServerFn,
          collectPhoneNumberFields,
          state: runtimeState,
          orgId: ctx.orgId,
          logContext: {
            ...requestLogContext,
            threadId: threadId!,
          },
        });
      const applyTurnRagGrounding = (buffered: string) =>
        applyRagGrounding({
          buffered,
          disabled: ragGroundingDisabled,
          mode: ragGroundingMode,
          minChunks: ragGroundingMinChunks,
          ragChunks,
          verifyRagGroundingFn,
          trackOpsEventServerFn,
          state: runtimeState,
          orgId: ctx.orgId,
          logContext: {
            ...requestLogContext,
            threadId: threadId!,
          },
        });
      const toolAuthorization: ToolExecutionAuthorization =
        ctx.role === "admin"
          ? {
              kind: "preverified_admin",
              source: "ai_org_context",
            }
          : {
              kind: "preverified_role",
              source: "ai_org_context",
              role: ctx.role,
            };
      const toolAuthMode = getToolAuthorizationMode(toolAuthorization);
      const recordUsage = (usage: Parameters<typeof recordTurnUsage>[1]) =>
        recordTurnUsage(runtimeState, usage);
      const emitTimeoutError = () =>
        enqueue({
          type: "error",
          message: "The response timed out. Please try again.",
          retryable: true,
        });

    try {
      if (!process.env.ZAI_API_KEY) {
        const msg =
          "AI assistant is not configured. Please set the ZAI_API_KEY environment variable.";
        enqueue({ type: "chunk", content: msg });
        fullContent = msg;
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        runtimeState.streamCompletedSuccessfully = true;
        return;
      }

      const client = createZaiClientFn();

      const { error: streamingStatusError } = await ctx.supabase
        .from("ai_messages")
        .update({
          intent: resolvedIntent,
          intent_type: resolvedIntentType,
          context_surface: effectiveSurface,
          status: "streaming",
        })
        .eq("id", assistantMessageId);

      if (streamingStatusError) {
        runtimeState.auditErrorMessage = "assistant_streaming_status_failed";
        aiLog("error", "ai-chat", "assistant streaming status update failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: streamingStatusError, messageId: assistantMessageId });
        enqueue({
          type: "error",
          message: "Failed to start the response stream",
          retryable: true,
        });
        return;
      }

      if (pendingEventRevisionAnalysis.kind === "clarify") {
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");

        fullContent = pendingEventRevisionAnalysis.message;
        enqueue({ type: "chunk", content: fullContent });
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        runtimeState.streamCompletedSuccessfully = true;
        return;
      }

      if (pendingEventRevisionAnalysis.kind === "unsupported_event_type") {
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");

        fullContent =
          `I can revise the drafted schedule before confirmation, but "${pendingEventRevisionAnalysis.requestedType}" isn't a supported event type yet. ` +
          `Use one of: ${SUPPORTED_EVENT_TYPE_LABELS.join(", ")}.`;
        enqueue({ type: "chunk", content: fullContent });
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        runtimeState.streamCompletedSuccessfully = true;
        return;
      }

      if (pendingEventRevisionAnalysis.kind === "apply" && activePendingEventActions.length > 0) {
        skipStage(stageTimings, "history_load");
        skipStage(stageTimings, "context_build");
        skipStage(stageTimings, "pass1_model");
        skipStage(stageTimings, "pass2");
        skipStage(stageTimings, "grounding");

        const revisedEvents = activePendingEventActions.map((action, index) =>
          pendingEventRevisionAnalysis.targetIndexes.includes(index)
            ? mergeDraftPayload(
                buildPrepareEventArgsFromPendingAction(action),
                pendingEventRevisionAnalysis.overrides
              )
            : buildPrepareEventArgsFromPendingAction(action)
        );
        const revisionToolName: ToolName =
          revisedEvents.length > 1 ? "prepare_events_batch" : "prepare_event";
        const revisionArgs =
          revisedEvents.length > 1 ? { events: revisedEvents } : revisedEvents[0];

        runtimeState.toolCallMade = true;
        auditToolCalls.push({
          name: revisionToolName,
          args: revisionArgs,
        });
        enqueue({ type: "tool_status", toolName: revisionToolName, status: "calling" });

        const toolStartedAt = Date.now();

        // Batch revisions (>1 active event) cannot preserve the per-row revise
        // cap because prepare_events_batch / buildPendingEventBatchFromDrafts
        // mints fresh rows in a loop. Reject explicitly so the user confirms
        // or cancels the existing batch instead of silently bypassing the cap.
        if (activePendingEventActions.length > 1) {
          addToolCallTiming(stageTimings, {
            name: revisionToolName,
            status: "failed",
            duration_ms: Date.now() - toolStartedAt,
            auth_mode: toolAuthMode,
            error_kind: "tool_error",
          });
          enqueue({ type: "tool_status", toolName: revisionToolName, status: "error" });
          enqueue({
            type: "error",
            message:
              "I can't revise a multi-event draft in place. Please confirm or cancel the current pending events, then ask again with the changes you want.",
            retryable: false,
          });
          return;
        }

        // Single-event revise: pass activePendingActionId so the executor's
        // createOrRevisePendingAction revises the existing row under the
        // 3-loop cap instead of minting a fresh one.
        const revisionResult = await executeToolCallFn(
          {
            orgId: ctx.orgId,
            userId: ctx.userId,
            enterpriseId: ctx.enterpriseId,
            enterpriseRole: ctx.enterpriseRole,
            supabase: ctx.supabase,
            serviceSupabase: ctx.serviceSupabase,
            authorization: toolAuthorization,
            threadId,
            requestId,
            attachment,
            activePendingActionId: activePendingEventActions[0].id,
          },
          {
            name: revisionToolName,
            args: revisionArgs,
          }
        );

        if (revisionResult.kind !== "ok") {
          addToolCallTiming(stageTimings, {
            name: revisionToolName,
            status: revisionResult.kind === "timeout" ? "timed_out" : "failed",
            duration_ms: Date.now() - toolStartedAt,
            auth_mode: toolAuthMode,
            error_kind: revisionResult.kind === "timeout" ? "timeout" : "tool_error",
          });
          enqueue({ type: "tool_status", toolName: revisionToolName, status: "error" });
          enqueue({
            type: "error",
            message:
              revisionResult.kind === "timeout"
                ? "Updating the drafted schedule timed out. Please try again."
                : revisionResult.error,
            retryable: revisionResult.kind === "timeout",
          });
          return;
        }

        addToolCallTiming(stageTimings, {
          name: revisionToolName,
          status: "completed",
          duration_ms: Date.now() - toolStartedAt,
          auth_mode: toolAuthMode,
        });
        enqueue({ type: "tool_status", toolName: revisionToolName, status: "done" });
        runtimeState.toolCallSucceeded = true;
        successfulToolResults.push({
          name: revisionToolName,
          data: revisionResult.data,
        });

        const pendingAction = getPendingActionFromToolData(revisionResult.data);
        if (pendingAction) {
          if (pendingAction.reviseCount !== null) {
            enqueue({
              type: "pending_action_updated",
              actionId: pendingAction.actionId,
              actionType: pendingAction.actionType,
              summary: pendingAction.summary,
              payload: pendingAction.payload,
              previousPayload: pendingAction.previousPayload,
              reviseCount: pendingAction.reviseCount,
              expiresAt: pendingAction.expiresAt,
            });
          } else {
            enqueue({
              type: "pending_action",
              actionId: pendingAction.actionId,
              actionType: pendingAction.actionType,
              summary: pendingAction.summary,
              payload: pendingAction.payload,
              expiresAt: pendingAction.expiresAt,
            });
          }
        }

        fullContent =
          formatRevisedPendingEventResponse(revisionResult.data, revisedEvents.length) ??
          "I revised the drafted schedule. Review the updated details below and confirm when you're ready.";
        enqueue({ type: "chunk", content: fullContent });
        enqueue({
          type: "done",
          threadId: threadId!,
          cache: {
            status: cacheStatus,
            ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
            ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
          },
        });
        runtimeState.streamCompletedSuccessfully = true;
        return;
      }

      const initHistory = await runInitChatHistoryStage({
        ctx,
        threadId: threadId!,
        existingThreadId,
        promptSafeMessage: messageSafety.promptSafeMessage,
        effectiveSurface,
        usesSharedStaticContext,
        usesToolFirstContext,
        ragChunks,
        requestNow,
        requestTimeZone,
        currentPath,
        routeEntityContext,
        availableTools: pass1Tools?.map((tool) => tool.function.name as ToolName),
        stageTimings,
        requestLogContext,
        buildPromptContextFn,
      });
      const { systemPrompt, orgContextMessage, metadata } = initHistory;
      runtimeState.contextMetadata = metadata;
      const historyRows = initHistory.historyRows;

      const draftSessionContextMessage = activeDraftSession
        ? buildDraftSessionContextMessage(activeDraftSession)
        : null;
      const historyMessages = (historyRows ?? [])
        .filter((m: any) => m.content)
        .map((m: any) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "user"
              ? sanitizeHistoryMessageForPrompt(m.content as string).promptSafeMessage
              : (m.content as string),
        }))
        .filter((m: { content: string }) => Boolean(m.content));
      const finalHistory =
        attachment &&
        historyMessages.length > 0 &&
        historyMessages[historyMessages.length - 1]?.role === "user"
          ? [
              ...historyMessages.slice(0, -1),
              {
                ...historyMessages[historyMessages.length - 1],
                content:
                  `${historyMessages[historyMessages.length - 1].content}\n\n` +
                  `[Attached schedule file: "${attachment.fileName}", storage path: "${attachment.storagePath}"]`,
              },
            ]
          : historyMessages;
      const pendingConnectionDisambiguation =
        hasPendingConnectionDisambiguation(finalHistory) &&
        looksLikeConnectionDisambiguationReply(messageSafety.promptSafeMessage);
      if (pendingConnectionDisambiguation) {
        pass1Tools = [AI_TOOL_MAP.suggest_connections];
      }
      const pass1Instructions: string[] = [];
      if (activeDraftSession) {
        pass1Instructions.push(ACTIVE_DRAFT_CONTINUATION_INSTRUCTION);
      }
      if (pass1Tools?.some((tool) => tool.function.name === "suggest_connections")) {
        pass1Instructions.push(CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION);
      }
      const effectivePass1SystemPrompt = pass1Instructions.length > 0
        ? `${systemPrompt}\n\n${pass1Instructions.join("\n\n")}`
        : systemPrompt;

      const contextMessages = orgContextMessage
        ? [
            { role: "user" as const, content: orgContextMessage },
            ...(draftSessionContextMessage
              ? [{ role: "user" as const, content: draftSessionContextMessage }]
              : []),
            ...finalHistory,
          ]
        : draftSessionContextMessage
          ? [{ role: "user" as const, content: draftSessionContextMessage }, ...finalHistory]
          : finalHistory;

      const toolResults: ToolResultMessage[] = [];
      const pass1ToolChoice = getForcedPass1ToolChoice(pass1Tools);
        const onToolCall = createToolCallHandler({
          ctx,
          toolAuthorization,
          toolAuthMode,
          threadId,
          requestId,
          attachment,
          message,
          currentPath,
          routeEntityContext,
          threadMetadata,
          canUseDraftSessions,
          requestLogContext,
          auditToolCalls,
          toolResults,
          successfulToolResults,
          runtimeState,
          stageTimings,
          enqueue,
          getActiveDraftSession: () => activeDraftSession,
          setActiveDraftSession: (next) => { activeDraftSession = next; },
          isToolPassBreakerOpen: () => toolPassBreakerOpen,
          setToolPassBreakerOpen: (open) => { toolPassBreakerOpen = open; },
          setTerminateTurn: () => { terminateTurn = true; },
          executeToolCallFn,
          saveDraftSessionFn,
        });
        const pass1Outcome = await runPass1({
          client,
          systemPrompt: effectivePass1SystemPrompt,
          messages: contextMessages,
          tools: pass1Tools,
          toolChoice: pass1ToolChoice,
          composeResponseFn,
          stageTimings,
          streamSignal,
          threadId: threadId!,
          requestLogContext,
          runtimeState,
          emitTimeoutError,
          onUsage: recordUsage,
          onChunk: (content) => {
            // Buffer pass-1 text until validators run. Freeform (no-tool)
            // path used to stream token-by-token; now buffered so RAG
            // grounding + safety gate can inspect before release.
            pass1BufferedContent += content;
          },
          onError: (event) => {
            runtimeState.auditErrorMessage = event.message;
            enqueue(event);
          },
          onToolCall,
        });

        if (terminateTurn || pass1Outcome !== "completed") {
          if (!runtimeState.toolCallMade) {
            skipStage(stageTimings, "tools");
          }
          return;
        }

        if (!runtimeState.toolCallMade) {
          skipStage(stageTimings, "tools");
        }

        if (!runtimeState.toolCallMade && pass1BufferedContent) {
          pass1BufferedContent = await applyTurnRagGrounding(pass1BufferedContent);
          pass1BufferedContent = await applyTurnSafetyGate(pass1BufferedContent);
          fullContent += pass1BufferedContent;
          enqueue({ type: "chunk", content: pass1BufferedContent });
        }

        if (runtimeState.toolCallMade && toolResults.length > 0) {
          const willRenderNavigationDeterministically =
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "find_navigation_targets";
          if (pass1BufferedContent && !willRenderNavigationDeterministically) {
            pass1BufferedContent = await applyTurnSafetyGate(pass1BufferedContent);
            fullContent += pass1BufferedContent;
            enqueue({ type: "chunk", content: pass1BufferedContent });
          }
          if (willRenderNavigationDeterministically) {
            pass1BufferedContent = "";
          }
          const canUseDeterministicMemberRoster =
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "list_members" &&
            MEMBER_ROSTER_PROMPT_PATTERN.test(messageSafety.promptSafeMessage);
          const needsDonorPrivacy = successfulToolResults.some(
            (result) => result.name === "list_donations",
          );
          const hideDonorNames = needsDonorPrivacy
            ? await resolveHideDonorNamesPreference(
                ctx.serviceSupabase as { from: (table: string) => any },
                ctx.orgId,
              )
            : false;
          const needsOrgSlug =
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "list_chat_groups";
          const orgSlug = needsOrgSlug
            ? await resolveOrgSlug(
                ctx.serviceSupabase as { from: (table: string) => any },
                ctx.orgId,
              )
            : undefined;
          const deterministicFormatterOptions =
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "list_donations"
              ? { hideDonorNames }
              : successfulToolResults.length === 1 &&
                successfulToolResults[0]?.name === "list_chat_groups"
              ? { orgSlug }
              : undefined;
          const deterministicToolContent =
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            toolResults[0].name === successfulToolResults[0].name &&
            (successfulToolResults[0].name !== "list_members" || canUseDeterministicMemberRoster)
              ? formatDeterministicToolResponse(
                  successfulToolResults[0].name,
                  successfulToolResults[0].data,
                  deterministicFormatterOptions,
                )
              : null;
          const singleToolError =
            toolResults.length === 1 &&
            successfulToolResults.length === 0 &&
            toolResults[0].data &&
            typeof toolResults[0].data === "object" &&
            "error" in toolResults[0].data &&
            typeof toolResults[0].data.error === "string"
              ? toolResults[0].data.error
              : null;
          const singleToolErrorCode =
            toolResults.length === 1 &&
            successfulToolResults.length === 0 &&
            toolResults[0].data &&
            typeof toolResults[0].data === "object" &&
            "error_code" in toolResults[0].data &&
            typeof toolResults[0].data.error_code === "string"
              ? toolResults[0].data.error_code
              : null;
          const deterministicToolErrorContent =
            singleToolError
              ? formatDeterministicToolErrorResponse(
                  toolResults[0].name,
                  singleToolError,
                  singleToolErrorCode
                )
              : null;

          if (deterministicToolContent || deterministicToolErrorContent) {
            skipStage(stageTimings, "pass2");
            pass2BufferedContent = deterministicToolContent ?? deterministicToolErrorContent ?? "";
          } else {
            const hasToolErrors = toolResults.length > successfulToolResults.length;
            const connectionPass2 = successfulToolResults.some(
              (result) => result.name === "suggest_connections"
            );
            const mentorPass2 = successfulToolResults.some(
              (result) => result.name === "suggest_mentors"
            );
            const memberRosterPass2 = successfulToolResults.some(
              (result) => result.name === "list_members"
            );
            const toolErrorInstruction = hasToolErrors
              ? "\n\nSome tool calls failed. Only cite data from successful tool results. Acknowledge any failures honestly — do not fabricate data."
              : "";
            const pass2Instructions = [
              connectionPass2 ? CONNECTION_PASS2_TEMPLATE : null,
              mentorPass2 ? MENTOR_PASS2_TEMPLATE : null,
              memberRosterPass2 ? MEMBER_LIST_PASS2_INSTRUCTION : null,
            ]
              .filter((value): value is string => Boolean(value))
              .join("\n\n");
            const pass2SystemPrompt = pass2Instructions.length > 0
              ? `${systemPrompt}\n\n${pass2Instructions}${toolErrorInstruction}`
              : `${systemPrompt}${toolErrorInstruction}`;

            const pass2Outcome = await runPass2({
              client,
              systemPrompt: pass2SystemPrompt,
              messages: contextMessages,
              toolResults,
              composeResponseFn,
              stageTimings,
              streamSignal,
              threadId: threadId!,
              requestLogContext,
              runtimeState,
              emitTimeoutError,
              onUsage: recordUsage,
              onChunk: (content) => {
                pass2BufferedContent += content;
              },
              onError: (event) => {
                runtimeState.auditErrorMessage = event.message;
                enqueue(event);
              },
            });

            if (pass2Outcome !== "completed") {
              return;
            }
          }

          pass2BufferedContent = await runGroundingCheck({
            pass2BufferedContent,
            successfulToolResults,
            executionPolicy,
            hideDonorNames,
            runtimeState,
            stageTimings,
            threadId: threadId!,
            assistantMessageId,
            orgId: ctx.orgId,
            requestLogContext,
            verifyToolBackedResponseFn,
            trackOpsEventServerFn,
          });

          if (pass2BufferedContent) {
            // Tool-backed pass-2: tool-grounding already ran. Still gate output
            // for safety (PII / toxicity) before release.
            pass2BufferedContent = await applyTurnSafetyGate(pass2BufferedContent);
            fullContent += pass2BufferedContent;
            enqueue({ type: "chunk", content: pass2BufferedContent });
          }
        } else {
          skipStage(stageTimings, "pass2");
          skipStage(stageTimings, "grounding");
        }

      if (fullContent.trim().length === 0) {
        fullContent = EMPTY_ASSISTANT_RESPONSE_FALLBACK;
        enqueue({ type: "chunk", content: fullContent });
        runtimeState.auditErrorMessage ??= "empty_response_fallback";
      }

      const usage = runtimeState.usage;
      enqueue({
        type: "done",
        threadId: threadId!,
        ...(usage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } } : {}),
        cache: {
          status: cacheStatus,
          ...(cacheEntryId ? { entryId: cacheEntryId } : {}),
          ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
        },
      });
      runtimeState.streamCompletedSuccessfully = true;
      } catch (err) {
        aiLog("error", "ai-chat", "stream error", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: err, messageId: assistantMessageId });
        runtimeState.auditErrorMessage = err instanceof Error ? err.message : "stream_failed";
        if (!streamSignal.aborted) {
          enqueue({ type: "error", message: "An error occurred", retryable: true });
        }
      } finally {
        await finalizeTurnAudit({
          ctx,
          threadId: threadId!,
          assistantMessageId,
          fullContent,
          runtimeState,
          streamSignal,
          stageTimings,
          executionPolicy,
          cacheStatus,
          cacheEntryId,
          cacheBypassReason,
          effectiveSurface,
          promptSafeMessage: messageSafety.promptSafeMessage,
          resolvedIntent,
          resolvedIntentType,
          auditToolCalls,
          ragChunkCount,
          ragTopSimilarity,
          ragError,
          startTime,
          requestLogContext,
          logAiRequestFn,
          getZaiModelFn,
        });
      }
    }, request.signal);

    return buildSseResponse(stream, { ...SSE_HEADERS, ...rateLimit.headers }, threadId!);
  };
}
