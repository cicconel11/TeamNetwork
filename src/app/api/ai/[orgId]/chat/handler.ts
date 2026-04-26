/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { buildPromptContext } from "@/lib/ai/context-builder";
import { composeResponse } from "@/lib/ai/response-composer";
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
import { createStageTimings } from "@/lib/ai/chat-telemetry";
import { aiLog } from "@/lib/ai/logger";
import {
  hasPendingConnectionDisambiguation,
  looksLikeConnectionDisambiguationReply,
  collectPhoneNumberFields,
} from "./handler/formatters/index";
import { getForcedPass1ToolChoice } from "./handler/pass1-tools";
import { buildDraftSessionContextMessage } from "./handler/draft-session";
import {
  ACTIVE_DRAFT_CONTINUATION_INSTRUCTION,
  CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION,
  EMPTY_ASSISTANT_RESPONSE_FALLBACK,
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
import { runModelToolsLoop } from "./handler/stages/run-model-tools-loop";
import { runPendingEventRevision } from "./handler/stages/run-pending-event-revision";
import { finalizeTurnAudit } from "./handler/stages/finalize-audit";

const MESSAGE_SAFETY_FALLBACK =
  "I can’t help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your organization’s data instead.";

const SCOPE_REFUSAL_FALLBACK =
  "I can only help with TeamNetwork tasks for your organization — like members, events, announcements, discussions, jobs, donations, or finding the right page. That request is outside what I do.";

/**
 * Resolve the Pass-1 bypass flag fail-closed: any unrecognized value (or
 * read error) maps to "off". Bypass is opt-in; never default-on under failure.
 */
function resolvePass1BypassMode(): "off" | "shadow" | "on" {
  try {
    const raw = (process.env.AI_PASS1_BYPASS ?? "").trim().toLowerCase();
    if (raw === "on") return "on";
    if (raw === "shadow") return "shadow";
    return "off";
  } catch {
    return "off";
  }
}

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
    const streamStartedAt = Date.now();
    const stream = createSSEStream(async (rawEnqueue, streamSignal) => {
      let fullContent = "";
      const runtimeState = createTurnRuntimeState();
      const enqueue: typeof rawEnqueue = (event) => {
        if (runtimeState.timeToFirstEventMs === undefined) {
          runtimeState.timeToFirstEventMs = Date.now() - streamStartedAt;
        }
        rawEnqueue(event);
      };
      const pass1BypassMode = resolvePass1BypassMode();
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

      const revisionOutcome = await runPendingEventRevision({
        pendingEventRevisionAnalysis,
        activePendingEventActions,
        ctx,
        toolAuthorization,
        toolAuthMode,
        threadId: threadId!,
        requestId,
        attachment,
        cacheStatus,
        cacheEntryId,
        cacheBypassReason,
        runtimeState,
        stageTimings,
        auditToolCalls,
        successfulToolResults,
        enqueue,
        executeToolCallFn,
      });
      if (revisionOutcome.status === "handled") {
        fullContent = revisionOutcome.fullContent;
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

      const pass1ToolChoice = getForcedPass1ToolChoice(pass1Tools);

        const loopOutcome = await runModelToolsLoop({
          client,
          systemPrompt,
          effectivePass1SystemPrompt,
          contextMessages,
          pass1Tools,
          pass1ToolChoice,
          ctx,
          toolAuthorization,
          toolAuthMode,
          threadId: threadId!,
          assistantMessageId,
          requestId,
          attachment,
          message,
          promptSafeMessage: messageSafety.promptSafeMessage,
          currentPath,
          routeEntityContext,
          threadMetadata,
          canUseDraftSessions,
          executionPolicy,
          requestLogContext,
          pass1BypassMode,
          pendingEventRevisionAnalysis,
          pendingConnectionDisambiguation,
          auditToolCalls,
          successfulToolResults,
          runtimeState,
          stageTimings,
          streamSignal,
          enqueue,
          recordUsage,
          emitTimeoutError,
          getActiveDraftSession: () => activeDraftSession,
          setActiveDraftSession: (next) => { activeDraftSession = next; },
          isToolPassBreakerOpen: () => toolPassBreakerOpen,
          setToolPassBreakerOpen: (open) => { toolPassBreakerOpen = open; },
          isTerminateTurn: () => terminateTurn,
          setTerminateTurn: () => { terminateTurn = true; },
          applyTurnRagGrounding,
          applyTurnSafetyGate,
          composeResponseFn,
          executeToolCallFn,
          saveDraftSessionFn,
          verifyToolBackedResponseFn,
          trackOpsEventServerFn,
        });

        if (!loopOutcome.completed) {
          return;
        }
        fullContent += loopOutcome.fullContent;

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
