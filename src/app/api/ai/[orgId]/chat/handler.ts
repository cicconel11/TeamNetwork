/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { sendMessageSchema } from "@/lib/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { buildPromptContext } from "@/lib/ai/context-builder";
import {
  composeResponse,
  type ToolCallRequestedEvent,
  type ToolResultMessage,
} from "@/lib/ai/response-composer";
import { logAiRequest } from "@/lib/ai/audit";
import { createSSEStream, SSE_HEADERS, type CacheStatus, type SSEEvent } from "@/lib/ai/sse";
import {
  AI_TOOL_MAP,
  type ToolName,
} from "@/lib/ai/tools/definitions";
import {
  buildPendingEventBatchFromDrafts,
  executeToolCall,
  getToolAuthorizationMode,
  type ToolExecutionAuthorization,
} from "@/lib/ai/tools/executor";
import { filterAllowedTools } from "@/lib/ai/access-policy";
import { resolveOwnThread, type AiThreadMetadata } from "@/lib/ai/thread-resolver";
import {
  checkCacheEligibility,
  type CacheSurface,
} from "@/lib/ai/semantic-cache-utils";
import { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import type { RagChunkInput } from "@/lib/ai/context-builder";
import { resolveSurfaceRouting } from "@/lib/ai/intent-router";
import {
  buildTurnExecutionPolicy,
  type TurnExecutionPolicy,
} from "@/lib/ai/turn-execution-policy";
import {
  extractCurrentMemberRouteId,
  extractRouteEntity,
  type RouteEntityContext,
} from "@/lib/ai/route-entity";
import { loadRouteEntityContext } from "@/lib/ai/route-entity-loaders";
import {
  verifyToolBackedResponse,
  type SuccessfulToolSummary,
} from "@/lib/ai/tool-grounding";
import {
  classifySafety,
} from "@/lib/ai/safety-gate";
import {
  verifyRagGrounding,
  type RagGroundingMode,
} from "@/lib/ai/rag-grounding";
import { trackOpsEventServer } from "@/lib/analytics/events-server";
import {
  assessAiMessageSafety,
  sanitizeHistoryMessageForPrompt,
} from "@/lib/ai/message-safety";
import {
  finalizeAssistantMessage,
  INTERRUPTED_ASSISTANT_MESSAGE,
} from "@/lib/ai/assistant-message-display";
import {
  clearDraftSession,
  getDraftSession,
  isDraftSessionExpired,
  saveDraftSession,
  supportsDraftSessionsStore,
  type DraftSessionRecord,
} from "@/lib/ai/draft-sessions";
import { updatePendingActionStatus } from "@/lib/ai/pending-actions";
import {
  createStageAbortSignal,
  isStageTimeoutError,
  PASS1_MODEL_TIMEOUT_MS,
  PASS2_MODEL_TIMEOUT_MS,
} from "@/lib/ai/timeout";
import {
  createStageTimings,
  setStageStatus,
  runTimedStage,
  skipStage,
  skipRemainingStages,
  addToolCallTiming,
  finalizeStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import {
  getNonEmptyString,
  hasPendingConnectionDisambiguation,
  looksLikeConnectionDisambiguationReply,
  collectPhoneNumberFields,
  formatDeterministicToolResponse,
  formatDeterministicToolErrorResponse,
  formatRevisedPendingEventResponse,
  resolveHideDonorNamesPreference,
  CONNECTION_PASS2_TEMPLATE,
} from "./handler/formatters/index";
import {
  type ChatAttachment,
} from "./handler/shared";
import {
  MEMBER_ROSTER_PROMPT_PATTERN,
  getForcedPass1ToolChoice,
  getPass1Tools,
  isToolFirstEligible,
} from "./handler/pass1-tools";
import {
  buildDraftSessionContextMessage,
  getToolNameForDraftType,
  inferDraftSessionFromHistory,
  mergeDraftPayload,
  shouldContinueDraftSession,
} from "./handler/draft-session";
import {
  buildDiscussionReplyClarificationPayload,
  isChatRecipientDemonstrative,
  isDiscussionThreadDemonstrative,
  resolveDiscussionReplyTarget,
  type PendingActionToolPayload,
} from "./handler/discussion-reply";
import {
  buildPrepareEventArgsFromPendingAction,
  getBatchPendingActionsFromToolData,
  getPendingActionFromToolData,
  listPendingEventActionsForThread,
  resolvePendingEventRevisionAnalysis,
  SUPPORTED_EVENT_TYPE_LABELS,
  type PendingEventActionRecord,
  type PendingEventRevisionAnalysis,
} from "./handler/pending-event-revision";
import {
  checkCache,
  retrieveRag,
  skipRagStage,
  writeCache,
} from "./handler/cache-rag";
import {
  ACTIVE_DRAFT_CONTINUATION_INSTRUCTION,
  CONNECTION_PASS1_DISAMBIGUATION_INSTRUCTION,
  EMPTY_ASSISTANT_RESPONSE_FALLBACK,
  MEMBER_LIST_PASS2_INSTRUCTION,
  MENTOR_PASS2_TEMPLATE,
  ToolGroundingVerificationError,
  applyRagGrounding,
  applySafetyGate,
  buildSseResponse,
  createTurnRuntimeState,
  getGroundingFallbackForTools,
  recordTurnUsage,
} from "./handler/sse-runtime";

export {
  CONNECTION_PASS2_TEMPLATE,
  collectPhoneNumberFields,
  formatSuggestConnectionsResponse,
} from "./handler/formatters/index";
export type { ChatAttachment } from "./handler/shared";

export interface ChatRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  buildPromptContext?: typeof buildPromptContext;
  createZaiClient?: typeof createZaiClient;
  getZaiModel?: typeof getZaiModel;
  composeResponse?: typeof composeResponse;
  logAiRequest?: typeof logAiRequest;
  resolveOwnThread?: typeof resolveOwnThread;
  retrieveRelevantChunks?: typeof retrieveRelevantChunks;
  executeToolCall?: typeof executeToolCall;
  buildTurnExecutionPolicy?: typeof buildTurnExecutionPolicy;
  verifyToolBackedResponse?: typeof verifyToolBackedResponse;
  classifySafety?: typeof classifySafety;
  verifyRagGrounding?: typeof verifyRagGrounding;
  trackOpsEventServer?: typeof trackOpsEventServer;
  getDraftSession?: typeof getDraftSession;
  saveDraftSession?: typeof saveDraftSession;
  clearDraftSession?: typeof clearDraftSession;
  loadRouteEntityContext?: typeof loadRouteEntityContext;
}

const DEFAULT_AI_ORG_RATE_LIMIT = 60;

function getAiOrgRateLimit(): number {
  const parsed = Number.parseInt(process.env.AI_ORG_RATE_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_ORG_RATE_LIMIT;
}

const MESSAGE_SAFETY_FALLBACK =
  "I can’t help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your organization’s data instead.";

const SCOPE_REFUSAL_FALLBACK =
  "I can only help with TeamNetwork tasks for your organization — like members, events, announcements, discussions, jobs, donations, or finding the right page. That request is outside what I do.";

const SCOPE_REFUSAL_CANONICAL_PREFIX = "I can only help with TeamNetwork tasks";

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
    const cacheDisabled = process.env.DISABLE_AI_CACHE === "true";
    const baseLogContext: AiLogContext = { requestId, orgId };
    // 1. Rate limit — get user first to allow per-user limiting
    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      orgId,
      userId: user?.id ?? null,
      feature: "ai-chat",
      limitPerIp: 30,
      limitPerUser: 20,
      limitPerOrg: getAiOrgRateLimit(),
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    // 2. Auth — validate role (admins always allowed; members/alumni gated by
    // AI_MEMBER_ACCESS_KILL env var inside getAiOrgContext)
    const ctx = await runTimedStage(stageTimings, "auth_org_context", async () =>
      getAiOrgContextFn(
        orgId,
        user,
        rateLimit,
        { supabase, logContext: baseLogContext },
        { allowedRoles: ["admin", "active_member", "alumni"] },
      )
    );
    if (!ctx.ok) return ctx.response;
    const canUseDraftSessions =
      supportsDraftSessionsStore(ctx.serviceSupabase) ||
      Boolean(deps.getDraftSession || deps.saveDraftSession || deps.clearDraftSession);
    const requestLogContext: AiLogContext = {
      ...baseLogContext,
      userId: ctx.userId,
    };

    // 3. Validate body and build policy
    let validatedBody: ReturnType<typeof sendMessageSchema.parse> extends infer T ? T : never;
    let message = "";
    let surface: typeof validatedBody.surface = "general";
    let existingThreadId: string | undefined;
    let idempotencyKey = "";
    let currentPath: string | undefined;
    let attachment: ChatAttachment | undefined;
    let messageSafety!: ReturnType<typeof assessAiMessageSafety>;
    let routing!: ReturnType<typeof resolveSurfaceRouting>;
    let effectiveSurface!: CacheSurface;
    let resolvedIntent!: ReturnType<typeof resolveSurfaceRouting>["intent"];
    let resolvedIntentType!: ReturnType<typeof resolveSurfaceRouting>["intentType"];
    let executionPolicy!: TurnExecutionPolicy;
    let usesSharedStaticContext = false;
    let pass1Tools: ReturnType<typeof getPass1Tools>;
    let activeDraftSession: DraftSessionRecord | null = null;
    let routeEntityContext: RouteEntityContext | null = null;
    let activePendingEventActions: PendingEventActionRecord[] = [];
    let pendingEventRevisionAnalysis: PendingEventRevisionAnalysis = { kind: "none" };
    let cacheStatus: CacheStatus;
    let cacheEntryId: string | undefined;
    let cacheBypassReason: string | undefined;

    try {
      await runTimedStage(stageTimings, "request_validation_policy", async () => {
        validatedBody = await validateJson(request, sendMessageSchema);
        ({
          message,
          surface,
          threadId: existingThreadId,
          idempotencyKey,
          currentPath,
          attachment,
        } = validatedBody);
        messageSafety = assessAiMessageSafety(message);
        routing = resolveSurfaceRouting(messageSafety.promptSafeMessage, surface);
        effectiveSurface = routing.effectiveSurface as CacheSurface;
        resolvedIntent = routing.intent;
        resolvedIntentType = routing.intentType;

        const eligibility = checkCacheEligibility({
          message: messageSafety.promptSafeMessage,
          threadId: existingThreadId,
          surface: effectiveSurface,
          bypassCache: validatedBody.bypassCache,
        });

        executionPolicy = buildTurnExecutionPolicyFn({
          message: messageSafety.promptSafeMessage,
          threadId: existingThreadId,
          requestedSurface: surface,
          routing,
          cacheEligibility: eligibility,
        });
        usesSharedStaticContext =
          executionPolicy.contextPolicy === "shared_static";
        stageTimings.retrieval = {
          decision: executionPolicy.retrieval.mode,
          reason: executionPolicy.retrieval.reason,
        };

        cacheStatus = cacheDisabled
          ? "disabled"
          : validatedBody.bypassCache
            ? "bypass"
            : "ineligible";
        cacheEntryId = undefined;
        cacheBypassReason = undefined;

        if (cacheDisabled && executionPolicy.cachePolicy === "lookup_exact") {
          cacheStatus = "disabled";
          cacheBypassReason = "disabled_via_env";
        } else if (executionPolicy.cachePolicy === "skip") {
          cacheBypassReason =
            executionPolicy.profile === "casual"
              ? "casual_turn"
              : executionPolicy.profile === "out_of_scope"
                ? "out_of_scope_request"
                : executionPolicy.profile === "out_of_scope_unrelated"
                  ? "scope_refusal"
                  : eligibility.eligible
                    ? executionPolicy.reasons[0]
                    : eligibility.reason;
        } else if (!eligibility.eligible) {
          cacheBypassReason = eligibility.reason;
        }

        pass1Tools = getPass1Tools(
          messageSafety.promptSafeMessage,
          effectiveSurface,
          executionPolicy.toolPolicy,
          executionPolicy.intentType,
          attachment,
          currentPath,
          Boolean(ctx.enterpriseId),
          ctx.enterpriseRole,
        );
        pass1Tools = filterAllowedTools(pass1Tools, {
          role: ctx.role,
          enterpriseRole: ctx.enterpriseRole,
        });
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return validationErrorResponse(err);
      }
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const requestNow = new Date().toISOString();
    const requestTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const skipRagRetrieval = executionPolicy.retrieval.mode === "skip";
    let usesToolFirstContext =
      !usesSharedStaticContext &&
      executionPolicy.retrieval.reason === "tool_only_structured_query" &&
      isToolFirstEligible(pass1Tools);

    // 4. Validate provided thread ownership before any cleanup or writes
    let threadId = existingThreadId;
    let threadMetadata: AiThreadMetadata = {};
    if (threadId) {
      const resolution = await runTimedStage(
        stageTimings,
        "thread_resolution",
        async () =>
          resolveOwnThreadFn(
            threadId!,
            ctx.userId,
            ctx.orgId,
            ctx.serviceSupabase,
            { ...requestLogContext, threadId: threadId! }
          )
      );
      if (!resolution.ok) {
        return NextResponse.json(
          { error: resolution.message },
          { status: resolution.status, headers: rateLimit.headers }
        );
      }
      threadMetadata = resolution.thread.metadata;

      if (canUseDraftSessions) {
        try {
          activeDraftSession = await getDraftSessionFn(ctx.serviceSupabase, {
            organizationId: ctx.orgId,
            userId: ctx.userId,
            threadId,
          });

          if (activeDraftSession && isDraftSessionExpired(activeDraftSession)) {
            try {
              await clearDraftSessionFn(ctx.serviceSupabase, {
                organizationId: ctx.orgId,
                userId: ctx.userId,
                threadId,
                pendingActionId: activeDraftSession.pending_action_id,
              });
            } catch (error) {
              aiLog("warn", "ai-chat", "failed to clear expired draft session", {
                ...requestLogContext,
                threadId,
              }, { error });
            }
            activeDraftSession = null;
          }

          if (activeDraftSession) {
            if (
              shouldContinueDraftSession(
                messageSafety.promptSafeMessage,
                activeDraftSession,
                routing
              )
            ) {
              pass1Tools = filterAllowedTools(
                [AI_TOOL_MAP[getToolNameForDraftType(activeDraftSession.draft_type)]],
                {
                  role: ctx.role,
                  enterpriseRole: ctx.enterpriseRole,
                },
              );
            } else {
              try {
                await clearDraftSessionFn(ctx.serviceSupabase, {
                  organizationId: ctx.orgId,
                  userId: ctx.userId,
                  threadId,
                  pendingActionId: activeDraftSession.pending_action_id,
                });
              } catch (error) {
                aiLog("warn", "ai-chat", "failed to clear abandoned draft session", {
                  ...requestLogContext,
                  threadId,
                }, { error });
              }
              activeDraftSession = null;
            }
          }
        } catch (error) {
          activeDraftSession = null;
          aiLog("warn", "ai-chat", "failed to load draft session; continuing without it", {
            ...requestLogContext,
            threadId,
          }, { error });
        }

        if (!activeDraftSession) {
          try {
            const { data: draftHistory, error: draftHistoryError } = await ctx.supabase
              .from("ai_messages")
              .select("role, content")
              .eq("thread_id", threadId)
              .eq("status", "complete")
              .order("created_at", { ascending: true })
              .limit(12);

            if (draftHistoryError) {
              aiLog("warn", "ai-chat", "failed to load thread history for draft inference", {
                ...requestLogContext,
                threadId,
              }, { error: draftHistoryError });
            } else {
              const inferredDraftSession = inferDraftSessionFromHistory({
                organizationId: ctx.orgId,
                userId: ctx.userId,
                threadId,
                messages: (draftHistory ?? [])
                  .filter(
                    (row: any): row is { role: "user" | "assistant"; content: string } =>
                      (row?.role === "user" || row?.role === "assistant") &&
                      typeof row?.content === "string" &&
                      row.content.trim().length > 0
                  )
                  .map((row: { role: "user" | "assistant"; content: string }) => ({
                    role: row.role,
                    content:
                      row.role === "user"
                        ? sanitizeHistoryMessageForPrompt(row.content).promptSafeMessage
                        : row.content,
                  })),
              });

              if (
                inferredDraftSession &&
                shouldContinueDraftSession(
                  messageSafety.promptSafeMessage,
                  inferredDraftSession,
                  routing
                )
              ) {
                activeDraftSession = inferredDraftSession;
                pass1Tools = filterAllowedTools(
                  [AI_TOOL_MAP[getToolNameForDraftType(inferredDraftSession.draft_type)]],
                  {
                    role: ctx.role,
                    enterpriseRole: ctx.enterpriseRole,
                  },
                );
              }
            }
          } catch (error) {
            aiLog("warn", "ai-chat", "failed to infer draft session from thread history", {
              ...requestLogContext,
              threadId,
            }, { error });
          }
        }
      }

      if (
        !attachment &&
        !activeDraftSession &&
        ctx.serviceSupabase &&
        typeof (ctx.serviceSupabase as { from?: unknown }).from === "function"
      ) {
        try {
          activePendingEventActions = await listPendingEventActionsForThread(ctx.serviceSupabase, {
            organizationId: ctx.orgId,
            userId: ctx.userId,
            threadId,
          });
          pendingEventRevisionAnalysis = resolvePendingEventRevisionAnalysis(
            messageSafety.promptSafeMessage,
            activePendingEventActions
          );
        } catch (error) {
          activePendingEventActions = [];
          pendingEventRevisionAnalysis = { kind: "none" };
          aiLog("warn", "ai-chat", "failed to load pending event actions; continuing without revision support", {
            ...requestLogContext,
            threadId,
          }, { error });
        }
      }
    } else {
      skipStage(stageTimings, "thread_resolution");
    }

    usesToolFirstContext =
      !usesSharedStaticContext &&
      executionPolicy.retrieval.reason === "tool_only_structured_query" &&
      isToolFirstEligible(pass1Tools);

    const routeEntityRef = extractRouteEntity(currentPath);
    if (routeEntityRef) {
      try {
        routeEntityContext = await loadRouteEntityContextFn({
          supabase: ctx.supabase as any,
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
          return NextResponse.json(
            { error: "Failed to resolve the current discussion thread" },
            { status: 500, headers: rateLimit.headers }
          );
        }
      }
    }

    // 5. Abandoned stream cleanup (5-min threshold)
    if (existingThreadId) {
      skipStage(stageTimings, "abandoned_stream_cleanup");
      void ctx.supabase
        .from("ai_messages")
        .update({ status: "error", content: INTERRUPTED_ASSISTANT_MESSAGE })
        .eq("thread_id", existingThreadId)
        .eq("role", "assistant")
        .in("status", ["pending", "streaming"])
        .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
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

    // 6. Idempotency check — look up by idempotency_key
    const { data: existingMsg, error: idempError } = await runTimedStage(
      stageTimings,
      "idempotency_lookup",
      async () =>
        ctx.supabase
          .from("ai_messages")
          .select("id, status, thread_id, created_at")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle()
    );

    if (idempError) {
      aiLog("error", "ai-chat", "idempotency check failed", requestLogContext, {
        error: idempError,
      });
      return NextResponse.json({ error: "Failed to check message idempotency" }, { status: 500 });
    }

    if (existingMsg) {
      if (existingMsg.status === "complete") {
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipRemainingStages(stageTimings, "cache_lookup");

        // Find the assistant reply that immediately follows the user message with this idempotency key
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
          return NextResponse.json(
            { error: "Failed to replay completed response" },
            { status: 500, headers: rateLimit.headers }
          );
        }

        if (!assistantReplay?.content) {
          return NextResponse.json(
            { error: "Request already in progress", threadId: existingMsg.thread_id },
            { status: 409, headers: rateLimit.headers }
          );
        }

        return buildSseResponse(
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
          existingMsg.thread_id
        );
      }
      return NextResponse.json(
        { error: "Request already in progress", threadId: existingMsg.thread_id },
        { status: 409, headers: rateLimit.headers }
      );
    }

    let preInitCacheHit:
      | {
          id: string;
          responseContent: string;
        }
      | undefined;
    let preInitCacheLookupPerformed = false;

    if (
      !cacheDisabled &&
      executionPolicy.cachePolicy === "lookup_exact" &&
      !existingThreadId &&
      messageSafety.riskLevel === "none"
    ) {
      preInitCacheLookupPerformed = true;
      const cacheResult = await checkCache({
        message: messageSafety.promptSafeMessage,
        orgId: ctx.orgId,
        role: ctx.role,
        surface: effectiveSurface,
        supabase: ctx.serviceSupabase,
        stageTimings,
        logContext: requestLogContext,
      });

      if (cacheResult.status === "hit") {
        preInitCacheHit = {
          id: cacheResult.hit.id,
          responseContent: cacheResult.hit.responseContent,
        };
      } else {
        cacheStatus = cacheResult.status === "miss" ? "miss" : "error";
        if (cacheResult.status === "error") {
          cacheBypassReason = "cache_lookup_failed";
        }
      }
    }

    // 7+8. Atomically create/reuse thread and insert user message via RPC
    const { data: initResult, error: initError } = await runTimedStage(
      stageTimings,
      "init_chat_rpc",
      async () =>
        (ctx.serviceSupabase as any).rpc("init_ai_chat", {
          p_user_id: ctx.userId,
          p_org_id: ctx.orgId,
          p_surface: surface,
          p_title: message.slice(0, 100),
          p_message: message,
          p_idempotency_key: idempotencyKey,
          p_thread_id: threadId ?? null,
          p_intent: resolvedIntent,
          p_context_surface: effectiveSurface,
          p_intent_type: resolvedIntentType,
        })
    );

    if (initError || !initResult) {
      aiLog("error", "ai-chat", "init_ai_chat RPC failed", requestLogContext, {
        error: initError,
      });
      return NextResponse.json(
        { error: "Failed to initialize chat" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    threadId = initResult.thread_id;

    const insertAssistantMessage = async (input: {
      content: string | null;
      status: "pending" | "complete";
    }) =>
      ctx.supabase
        .from("ai_messages")
        .insert({
          thread_id: threadId,
          org_id: ctx.orgId,
          user_id: ctx.userId,
          role: "assistant",
          intent: resolvedIntent,
          intent_type: resolvedIntentType,
          context_surface: effectiveSurface,
          status: input.status,
          content: input.content,
        })
        .select("id")
        .single();

    if (messageSafety.riskLevel !== "none") {
      cacheStatus = "bypass";
      cacheBypassReason = `message_safety_${messageSafety.riskLevel}`;
      stageTimings.retrieval = {
        decision: "skip",
        reason: "message_safety_blocked",
      };
      skipRemainingStages(stageTimings, "cache_lookup");

      const { data: safetyAssistantMsg, error: safetyAssistantError } =
        await insertAssistantMessage({
          content: MESSAGE_SAFETY_FALLBACK,
          status: "complete",
        });

      if (safetyAssistantError || !safetyAssistantMsg) {
        aiLog("error", "ai-chat", "safety assistant message failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: safetyAssistantError });
        return NextResponse.json(
          { error: "Failed to create response" },
          { status: 500, headers: rateLimit.headers }
        );
      }

      void trackOpsEventServerFn(
        "api_error",
        {
          endpoint_group: "ai-safety",
          http_status: 200,
          error_code: `message_safety_${messageSafety.riskLevel}`,
          retryable: false,
        },
        ctx.orgId
      );

      await logAiRequestFn(ctx.serviceSupabase, {
        threadId: threadId!,
        messageId: safetyAssistantMsg.id,
        userId: ctx.userId,
        orgId: ctx.orgId,
        intent: resolvedIntent,
        intentType: resolvedIntentType,
        latencyMs: Date.now() - startTime,
        error: `message_safety_${messageSafety.riskLevel}:${messageSafety.reasons.join(",")}`,
        cacheStatus,
        cacheBypassReason,
        contextSurface: effectiveSurface,
        stageTimings: finalizeStageTimings(
          stageTimings,
          "message_safety_blocked",
          Date.now() - startTime
        ),
      }, {
        ...requestLogContext,
        threadId: threadId!,
      });

      return buildSseResponse(
        createSSEStream(async (enqueue) => {
          enqueue({ type: "chunk", content: MESSAGE_SAFETY_FALLBACK });
          enqueue({
            type: "done",
            threadId: threadId!,
            cache: {
              status: cacheStatus,
              ...(cacheBypassReason ? { bypassReason: cacheBypassReason } : {}),
            },
          });
        }),
        { ...SSE_HEADERS, ...rateLimit.headers },
        threadId!
      );
    }

    if (executionPolicy.profile === "out_of_scope_unrelated") {
      const refusalReason =
        executionPolicy.reasons[0]?.replace(/^out_of_scope_/, "") ??
        "unrelated_pattern";
      cacheStatus = "bypass";
      cacheBypassReason = "scope_refusal";
      stageTimings.retrieval = {
        decision: "skip",
        reason: "out_of_scope_request",
      };
      skipRemainingStages(stageTimings, "cache_lookup");

      const { data: scopeAssistantMsg, error: scopeAssistantError } =
        await insertAssistantMessage({
          content: SCOPE_REFUSAL_FALLBACK,
          status: "complete",
        });

      if (scopeAssistantError || !scopeAssistantMsg) {
        aiLog("error", "ai-chat", "scope refusal assistant message failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: scopeAssistantError });
        return NextResponse.json(
          { error: "Failed to create response" },
          { status: 500, headers: rateLimit.headers }
        );
      }

      void trackOpsEventServerFn(
        "api_error",
        {
          endpoint_group: "ai-scope",
          http_status: 200,
          error_code: `scope_refusal_${refusalReason}`,
          retryable: false,
        },
        ctx.orgId
      );

      await logAiRequestFn(ctx.serviceSupabase, {
        threadId: threadId!,
        messageId: scopeAssistantMsg.id,
        userId: ctx.userId,
        orgId: ctx.orgId,
        intent: resolvedIntent,
        intentType: resolvedIntentType,
        latencyMs: Date.now() - startTime,
        error: `scope_refusal:${refusalReason}`,
        cacheStatus,
        cacheBypassReason,
        contextSurface: effectiveSurface,
        stageTimings: finalizeStageTimings(
          stageTimings,
          "out_of_scope_request",
          Date.now() - startTime
        ),
      }, {
        ...requestLogContext,
        threadId: threadId!,
      });

      return buildSseResponse(
        createSSEStream(async (enqueue) => {
          enqueue({ type: "chunk", content: SCOPE_REFUSAL_FALLBACK });
          enqueue({
            type: "done",
            threadId: threadId!,
            cache: {
              status: cacheStatus,
              bypassReason: cacheBypassReason,
            },
          });
        }),
        { ...SSE_HEADERS, ...rateLimit.headers },
        threadId!
      );
    }

    if (preInitCacheHit) {
      const { data: cachedAssistantMsg, error: cachedAssistantError } =
        await insertAssistantMessage({
          content: preInitCacheHit.responseContent,
          status: "complete",
        });

      if (cachedAssistantError || !cachedAssistantMsg) {
        aiLog("error", "ai-chat", "cache hit assistant message failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: cachedAssistantError });
        cacheStatus = "error";
        cacheBypassReason = "cache_hit_persist_failed";
      } else {
        cacheStatus = "hit_exact";
        cacheEntryId = preInitCacheHit.id;
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipRemainingStages(stageTimings, "rag_retrieval");

        const cachedStream = createSSEStream(async (enqueue) => {
          enqueue({ type: "chunk", content: preInitCacheHit!.responseContent });
          enqueue({
            type: "done",
            threadId: threadId!,
            replayed: true,
            cache: { status: "hit_exact", entryId: preInitCacheHit!.id },
          });
        });

        await logAiRequestFn(ctx.serviceSupabase, {
          threadId: threadId!,
          messageId: cachedAssistantMsg.id,
          userId: ctx.userId,
          orgId: ctx.orgId,
          intent: resolvedIntent,
          intentType: resolvedIntentType,
          latencyMs: Date.now() - startTime,
          cacheStatus: "hit_exact",
          cacheEntryId: preInitCacheHit.id,
          contextSurface: effectiveSurface,
          stageTimings: finalizeStageTimings(stageTimings, "cache_hit", Date.now() - startTime),
        }, {
          ...requestLogContext,
          threadId: threadId!,
        });

        return buildSseResponse(
          cachedStream,
          { ...SSE_HEADERS, ...rateLimit.headers },
          threadId!
        );
      }
    }

    if (
      !preInitCacheLookupPerformed &&
      !cacheDisabled &&
      executionPolicy.cachePolicy === "lookup_exact"
    ) {
      const cacheResult = await checkCache({
        message: messageSafety.promptSafeMessage,
        orgId: ctx.orgId,
        role: ctx.role,
        surface: effectiveSurface,
        supabase: ctx.serviceSupabase,
        stageTimings,
        logContext: {
          ...requestLogContext,
          threadId: threadId!,
        },
      });

      if (cacheResult.status === "hit") {
        cacheStatus = "hit_exact";
        cacheEntryId = cacheResult.hit.id;
        stageTimings.retrieval = {
          decision: "skip",
          reason: "cache_hit",
        };
        skipRemainingStages(stageTimings, "rag_retrieval");

        const { data: cachedAssistantMsg, error: cachedAssistantError } =
          await insertAssistantMessage({
            content: cacheResult.hit.responseContent,
            status: "complete",
          });

        if (cachedAssistantError || !cachedAssistantMsg) {
          aiLog("error", "ai-chat", "cache hit assistant message failed", {
            ...requestLogContext,
            threadId: threadId!,
          }, { error: cachedAssistantError });
          cacheStatus = "error";
          cacheBypassReason = "cache_hit_persist_failed";
        } else {
          const cachedStream = createSSEStream(async (enqueue) => {
            enqueue({ type: "chunk", content: cacheResult.hit.responseContent });
            enqueue({
              type: "done",
              threadId: threadId!,
              replayed: true,
              cache: { status: "hit_exact", entryId: cacheResult.hit.id },
            });
          });

          await logAiRequestFn(ctx.serviceSupabase, {
            threadId: threadId!,
            messageId: cachedAssistantMsg.id,
            userId: ctx.userId,
            orgId: ctx.orgId,
            intent: resolvedIntent,
            intentType: resolvedIntentType,
            latencyMs: Date.now() - startTime,
            cacheStatus: "hit_exact",
            cacheEntryId: cacheResult.hit.id,
            contextSurface: effectiveSurface,
            stageTimings: finalizeStageTimings(stageTimings, "cache_hit", Date.now() - startTime),
          }, {
            ...requestLogContext,
            threadId: threadId!,
          });

          return buildSseResponse(
            cachedStream,
            { ...SSE_HEADERS, ...rateLimit.headers },
            threadId!
          );
        }
      } else {
        cacheStatus = cacheResult.status === "miss" ? "miss" : "error";
        if (cacheResult.status === "error") {
          cacheBypassReason = "cache_lookup_failed";
        }
      }
    } else if (!preInitCacheLookupPerformed) {
      skipStage(stageTimings, "cache_lookup");
    }

    let ragChunks: RagChunkInput[] = [];
    let ragChunkCount = 0;
    let ragTopSimilarity: number | undefined;
    let ragError: string | undefined;

    const hasEmbeddingKey = !!process.env.EMBEDDING_API_KEY;
    if (hasEmbeddingKey && !skipRagRetrieval) {
      const ragResult = await retrieveRag({
        retrieveRelevantChunksFn,
        query: messageSafety.promptSafeMessage,
        orgId: ctx.orgId,
        serviceSupabase: ctx.serviceSupabase,
        stageTimings,
        logContext: {
          ...requestLogContext,
          threadId: threadId!,
        },
      });
      ragChunks = ragResult.chunks;
      ragChunkCount = ragResult.chunkCount;
      ragTopSimilarity = ragResult.topSimilarity;
      ragError = ragResult.error;
    } else {
      if (!hasEmbeddingKey && executionPolicy.retrieval.mode === "allow") {
        stageTimings.retrieval = {
          decision: "not_available",
          reason: "embedding_key_missing",
        };
      }
      skipRagStage(stageTimings);
    }

    const { data: assistantMsg, error: assistantError } = await runTimedStage(
      stageTimings,
      "assistant_placeholder_write",
      async () =>
        insertAssistantMessage({
          content: null,
          status: "pending",
        })
    );

    if (assistantError || !assistantMsg) {
      aiLog("error", "ai-chat", "assistant placeholder failed", {
        ...requestLogContext,
        threadId: threadId!,
      }, { error: assistantError });
      return NextResponse.json(
        { error: "Failed to create response" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    const assistantMessageId = assistantMsg.id;

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
      const runModelStage = async (
        stage: "pass1_model" | "pass2_model",
        auditStage: "pass1_model" | "pass2",
        timeoutMs: number,
        options: Parameters<typeof composeResponseFn>[0],
        onEvent: (event: SSEEvent | ToolCallRequestedEvent) => Promise<"continue" | "stop"> | "continue" | "stop"
      ): Promise<"completed" | "stopped" | "timeout" | "aborted"> => {
        const stageSignal = createStageAbortSignal({
          stage,
          timeoutMs,
          parentSignal: streamSignal,
        });
        const stageStartedAt = Date.now();

        try {
          for await (const event of composeResponseFn({
            ...options,
            signal: stageSignal.signal,
            logContext: {
              ...requestLogContext,
              threadId: threadId!,
            },
          })) {
            const disposition = await onEvent(event as SSEEvent | ToolCallRequestedEvent);
            if (disposition === "stop") {
              setStageStatus(
                stageTimings,
                auditStage,
                "completed",
                Date.now() - stageStartedAt
              );
              return "stopped";
            }
          }
          setStageStatus(stageTimings, auditStage, "completed", Date.now() - stageStartedAt);
          return "completed";
        } catch (err) {
          const failureReason = stageSignal.signal.reason ?? err;
          if (isStageTimeoutError(failureReason)) {
            setStageStatus(stageTimings, auditStage, "timed_out", Date.now() - stageStartedAt);
            runtimeState.auditErrorMessage = `${stage}:timeout`;
            emitTimeoutError();
            return "timeout";
          }
          if (streamSignal.aborted || stageSignal.signal.aborted) {
            setStageStatus(stageTimings, auditStage, "aborted", Date.now() - stageStartedAt);
            runtimeState.auditErrorMessage = `${stage}:request_aborted`;
            return "aborted";
          }
          setStageStatus(stageTimings, auditStage, "failed", Date.now() - stageStartedAt);
          throw err;
        } finally {
          stageSignal.cleanup();
        }
      };

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
        const revisedOrgSlug = activePendingEventActions.find((action) =>
          action.payload &&
          typeof action.payload === "object" &&
          typeof action.payload.orgSlug === "string" &&
          action.payload.orgSlug.trim().length > 0
        )?.payload.orgSlug ?? null;

        runtimeState.toolCallMade = true;
        auditToolCalls.push({
          name: revisionToolName,
          args: revisionArgs,
        });
        enqueue({ type: "tool_status", toolName: revisionToolName, status: "calling" });

        const toolStartedAt = Date.now();
        const revisionResult =
          revisedEvents.length > 10
            ? ({
                kind: "ok",
                data: await buildPendingEventBatchFromDrafts(
                  ctx.serviceSupabase as any,
                  {
                    orgId: ctx.orgId,
                    userId: ctx.userId,
                    enterpriseId: ctx.enterpriseId,
                    enterpriseRole: ctx.enterpriseRole,
                    serviceSupabase: ctx.serviceSupabase,
                    authorization: toolAuthorization,
                    threadId,
                    requestId,
                    attachment,
                  },
                  revisedEvents,
                  {
                    ...requestLogContext,
                    threadId: threadId!,
                  },
                  revisedOrgSlug
                ),
              } as const)
            : await executeToolCallFn(
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
        const batchActions = getBatchPendingActionsFromToolData(revisionResult.data);
        if (pendingAction || batchActions) {
          for (const action of activePendingEventActions) {
            await updatePendingActionStatus(ctx.serviceSupabase, action.id, {
              status: "cancelled",
              expectedStatus: "pending",
            });
          }
        }

        if (pendingAction) {
          enqueue({
            type: "pending_action",
            actionId: pendingAction.actionId,
            actionType: pendingAction.actionType,
            summary: pendingAction.summary,
            payload: pendingAction.payload,
            expiresAt: pendingAction.expiresAt,
          });
        } else if (batchActions) {
          enqueue({
            type: "pending_actions_batch",
            actions: batchActions,
          });
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

        const contextBuildStartedAt = Date.now();
        const historyLoadStartedAt = Date.now();
        const historyPromise = existingThreadId
          ? ctx.supabase
              .from("ai_messages")
              .select("role, content")
              .eq("thread_id", threadId)
              .eq("status", "complete")
              .order("created_at", { ascending: true })
              .limit(20)
              .then((result: { data: unknown; error: unknown }) => {
                setStageStatus(
                  stageTimings,
                  "history_load",
                  result.error ? "failed" : "completed",
                  Date.now() - historyLoadStartedAt
                );
                return result;
              })
              .catch((error: unknown) => {
                setStageStatus(
                  stageTimings,
                  "history_load",
                  "failed",
                  Date.now() - historyLoadStartedAt
                );
                throw error;
              })
          : Promise.resolve().then(() => {
              setStageStatus(
                stageTimings,
                "history_load",
                "completed",
                Date.now() - historyLoadStartedAt
              );
              return {
                data: [
                  {
                    role: "user",
                    content: messageSafety.promptSafeMessage,
                  },
                ],
                error: null,
              };
            });

        const [contextResult, { data: history, error: historyError }] =
          await Promise.all([
            buildPromptContextFn({
              orgId: ctx.orgId,
              userId: ctx.userId,
              role: ctx.role,
              enterpriseId: ctx.enterpriseId,
              enterpriseRole: ctx.enterpriseRole,
              serviceSupabase: ctx.serviceSupabase,
              logContext: {
                ...requestLogContext,
                threadId: threadId!,
              },
              contextMode: usesSharedStaticContext
                ? "shared_static"
                : usesToolFirstContext
                  ? "tool_first"
                  : "full",
              surface: effectiveSurface,
              ragChunks: ragChunks.length > 0 ? ragChunks : undefined,
              now: requestNow,
              timeZone: requestTimeZone,
              currentPath,
              routeEntity: routeEntityContext,
              availableTools: pass1Tools?.map((tool) => tool.function.name as ToolName),
              threadTurnCount: existingThreadId ? 2 : 1,
            }).then((result: Awaited<ReturnType<typeof buildPromptContext>>) => {
              setStageStatus(
                stageTimings,
                "context_build",
                "completed",
                Date.now() - contextBuildStartedAt
              );
              return result;
            }).catch((error: unknown) => {
              setStageStatus(
                stageTimings,
                "context_build",
                "failed",
                Date.now() - contextBuildStartedAt
              );
                throw error;
              }),
            historyPromise,
          ]);

      const { systemPrompt, orgContextMessage, metadata } = contextResult;
      runtimeState.contextMetadata = metadata;

      let historyRows = history;
      if (historyError) {
        aiLog("error", "ai-chat", "history fetch failed", {
          ...requestLogContext,
          threadId: threadId!,
        }, { error: historyError });
        historyRows = [
          {
            role: "user",
            content: messageSafety.promptSafeMessage,
          },
        ];
      }

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
        const pass1Outcome = await runModelStage(
          "pass1_model",
          "pass1_model",
          PASS1_MODEL_TIMEOUT_MS,
          {
            client,
            systemPrompt: effectivePass1SystemPrompt,
            messages: contextMessages,
            tools: pass1Tools,
            toolChoice: pass1ToolChoice,
            onUsage: recordUsage,
          },
          async (event) => {
            if (event.type === "chunk") {
              // Buffer pass-1 text until validators run. Freeform (no-tool)
              // path used to stream token-by-token; now buffered so RAG
              // grounding + safety gate can inspect before release.
              pass1BufferedContent += event.content;
              return "continue";
            }

            if (event.type === "error") {
              runtimeState.auditErrorMessage = event.message;
              enqueue(event);
              return "stop";
            }

            const toolEvent = event as ToolCallRequestedEvent;
            runtimeState.toolCallMade = true;

            let parsedArgs: Record<string, unknown>;
            try {
              parsedArgs = JSON.parse(toolEvent.argsJson);
            } catch {
              enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
              auditToolCalls.push({ name: toolEvent.name, args: {} });
              addToolCallTiming(stageTimings, {
                name: toolEvent.name,
                status: "failed",
                duration_ms: 0,
                auth_mode: toolAuthMode,
                error_kind: "tool_error",
              });
              toolResults.push({
                toolCallId: toolEvent.id,
                name: toolEvent.name,
                args: {},
                data: { error: "Malformed tool arguments" },
              });
              return "continue";
            }

            if (
              activeDraftSession &&
              toolEvent.name === getToolNameForDraftType(activeDraftSession.draft_type)
            ) {
              parsedArgs = mergeDraftPayload(
                activeDraftSession.draft_payload as Record<string, unknown>,
                parsedArgs
              );
            }

            if (toolEvent.name === "prepare_chat_message") {
              const currentMemberRouteId =
                routeEntityContext?.kind === "member"
                  ? routeEntityContext.id
                  : extractCurrentMemberRouteId(currentPath);
              if (currentMemberRouteId && isChatRecipientDemonstrative(message)) {
                parsedArgs.recipient_member_id = currentMemberRouteId;
                delete parsedArgs.person_query;
              } else if (
                currentMemberRouteId &&
                getNonEmptyString(parsedArgs.recipient_member_id) == null &&
                getNonEmptyString(parsedArgs.person_query) == null
              ) {
                parsedArgs.recipient_member_id = currentMemberRouteId;
              } else if (
                threadMetadata.last_chat_recipient_member_id &&
                getNonEmptyString(parsedArgs.recipient_member_id) == null &&
                getNonEmptyString(parsedArgs.person_query) == null
              ) {
                // Use the last chat recipient from thread metadata for follow-up messages
                parsedArgs.recipient_member_id = threadMetadata.last_chat_recipient_member_id;
              }
            }

            let syntheticToolResult:
              | Awaited<ReturnType<typeof executeToolCallFn>>
              | null = null;
            if (toolEvent.name === "prepare_discussion_reply") {
              const discussionThreadId = getNonEmptyString(parsedArgs.discussion_thread_id);
              const requestedThreadTitle = getNonEmptyString(parsedArgs.thread_title);
              const explicitNamedThreadTitle =
                requestedThreadTitle && !isDiscussionThreadDemonstrative(requestedThreadTitle)
                  ? requestedThreadTitle
                  : null;

              if (!discussionThreadId && explicitNamedThreadTitle) {
                const resolution = await resolveDiscussionReplyTarget(ctx.serviceSupabase as any, {
                  organizationId: ctx.orgId,
                  requestedThreadTitle: explicitNamedThreadTitle,
                });

                if (resolution.kind === "resolved") {
                  parsedArgs.discussion_thread_id = resolution.discussionThreadId;
                  parsedArgs.thread_title = resolution.threadTitle ?? explicitNamedThreadTitle;
                } else {
                  if (resolution.kind === "lookup_error") {
                    aiLog("warn", "ai-chat", "discussion thread title resolution failed", {
                      ...requestLogContext,
                      threadId: threadId ?? undefined,
                    }, {
                      requestedThreadTitle: explicitNamedThreadTitle,
                    });
                  }
                  syntheticToolResult = {
                    kind: "ok",
                    data: buildDiscussionReplyClarificationPayload(parsedArgs, resolution),
                  };
                }
              } else if (
                routeEntityContext?.kind === "discussion_thread" &&
                !discussionThreadId
              ) {
                parsedArgs.discussion_thread_id =
                  routeEntityContext.id;
                if (
                  getNonEmptyString(parsedArgs.thread_title) == null &&
                  routeEntityContext.displayName
                ) {
                  parsedArgs.thread_title = routeEntityContext.displayName;
                }
              } else if (!discussionThreadId && !syntheticToolResult) {
                syntheticToolResult = {
                  kind: "ok",
                  data: buildDiscussionReplyClarificationPayload(parsedArgs, {
                    kind: "thread_title_required",
                  }),
                };
              }
            }

            auditToolCalls.push({ name: toolEvent.name, args: parsedArgs });

            if (toolPassBreakerOpen) {
              return "continue";
            }

            const toolStartedAt = Date.now();
            let result: Awaited<ReturnType<typeof executeToolCallFn>>;
            if (syntheticToolResult) {
              result = syntheticToolResult;
            } else {
              enqueue({ type: "tool_status", toolName: toolEvent.name, status: "calling" });

              const activePendingActionId =
                toolEvent.name.startsWith("prepare_") &&
                activeDraftSession?.pending_action_id
                  ? activeDraftSession.pending_action_id
                  : null;

              result = await executeToolCallFn(
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
                  activePendingActionId,
                },
                { name: toolEvent.name, args: parsedArgs }
              );
            }

            switch (result.kind) {
              case "ok":
                if (
                  canUseDraftSessions &&
                  (toolEvent.name === "prepare_announcement" ||
                    toolEvent.name === "prepare_job_posting" ||
                    toolEvent.name === "prepare_chat_message" ||
                    toolEvent.name === "prepare_discussion_reply" ||
                    toolEvent.name === "prepare_discussion_thread" ||
                    toolEvent.name === "prepare_event") &&
                  result.data &&
                  typeof result.data === "object"
                ) {
                  const toolData = result.data as PendingActionToolPayload;
                  if (
                    toolData.state === "missing_fields" ||
                    toolData.state === "needs_confirmation"
                  ) {
                    const missingFields = Array.isArray(toolData.missing_fields)
                      ? toolData.missing_fields.filter(
                          (field): field is string =>
                            typeof field === "string" && field.length > 0
                        )
                      : [];
                    const pendingActionId =
                      toolData.pending_action &&
                      typeof toolData.pending_action === "object" &&
                      typeof toolData.pending_action.id === "string"
                        ? toolData.pending_action.id
                        : null;
                    const pendingExpiresAt =
                      toolData.pending_action &&
                      typeof toolData.pending_action === "object" &&
                      typeof toolData.pending_action.expires_at === "string"
                        ? toolData.pending_action.expires_at
                        : undefined;

                    try {
                      activeDraftSession = await saveDraftSessionFn(ctx.serviceSupabase, {
                        organizationId: ctx.orgId,
                        userId: ctx.userId,
                        threadId: threadId!,
                        draftType:
                          toolEvent.name === "prepare_announcement"
                            ? "create_announcement"
                            : toolEvent.name === "prepare_job_posting"
                            ? "create_job_posting"
                            : toolEvent.name === "prepare_chat_message"
                            ? "send_chat_message"
                            : toolEvent.name === "prepare_discussion_reply"
                              ? "create_discussion_reply"
                            : toolEvent.name === "prepare_discussion_thread"
                              ? "create_discussion_thread"
                              : "create_event",
                        status:
                          toolData.state === "needs_confirmation"
                            ? "ready_for_confirmation"
                            : "collecting_fields",
                        draftPayload:
                          toolData.draft && typeof toolData.draft === "object"
                            ? (toolData.draft as any)
                            : (parsedArgs as any),
                        missingFields,
                        pendingActionId,
                        expiresAt: pendingExpiresAt,
                      });
                    } catch (error) {
                      activeDraftSession = null;
                      aiLog("warn", "ai-chat", "failed to persist draft session; continuing without it", {
                        ...requestLogContext,
                        threadId: threadId!,
                      }, { error, toolName: toolEvent.name });
                    }
                  }
                }

                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "completed",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "done" });
                runtimeState.toolCallSucceeded = true;
                toolResults.push({
                  toolCallId: toolEvent.id,
                  name: toolEvent.name,
                  args: parsedArgs,
                  data: result.data,
                });
                const pendingAction = getPendingActionFromToolData(result.data);
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
                } else {
                  const batchActions = getBatchPendingActionsFromToolData(result.data);
                  if (batchActions) {
                    enqueue({
                      type: "pending_actions_batch",
                      actions: batchActions,
                    });
                  }
                }
                successfulToolResults.push({
                  name: toolEvent.name as ToolName,
                  data: result.data,
                });
                return "continue";
              case "tool_error":
                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "failed",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                  error_kind: "tool_error",
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                toolResults.push({
                  toolCallId: toolEvent.id,
                  name: toolEvent.name,
                  args: parsedArgs,
                  data: {
                    error: result.error,
                    error_code: result.code,
                  },
                });
                return "continue";
              case "timeout":
                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "timed_out",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                  error_kind: "timeout",
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                toolResults.push({
                  toolCallId: toolEvent.id,
                  name: toolEvent.name,
                  args: parsedArgs,
                  data: { error: result.error },
                });
                toolPassBreakerOpen = true;
                return "continue";
              case "forbidden":
              case "auth_error":
                addToolCallTiming(stageTimings, {
                  name: toolEvent.name,
                  status: "failed",
                  duration_ms: Date.now() - toolStartedAt,
                  auth_mode: toolAuthMode,
                  error_kind: result.kind,
                });
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                runtimeState.auditErrorMessage = `tool_${toolEvent.name}:${result.kind}`;
                terminateTurn = true;
                enqueue({
                  type: "error",
                  message:
                    result.kind === "forbidden"
                      ? "Your access to AI tools for this organization has changed."
                      : "Unable to verify access to AI tools right now.",
                  retryable: false,
                });
                return "stop";
            }
          }
        );

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
          const deterministicDonationOptions =
            successfulToolResults.length === 1 &&
            successfulToolResults[0]?.name === "list_donations"
              ? { hideDonorNames }
              : undefined;
          const deterministicToolContent =
            toolResults.length === 1 &&
            successfulToolResults.length === 1 &&
            toolResults[0].name === successfulToolResults[0].name &&
            (successfulToolResults[0].name !== "list_members" || canUseDeterministicMemberRoster)
              ? formatDeterministicToolResponse(
                  successfulToolResults[0].name,
                  successfulToolResults[0].data,
                  deterministicDonationOptions,
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

            const pass2Outcome = await runModelStage(
              "pass2_model",
              "pass2",
              PASS2_MODEL_TIMEOUT_MS,
              {
                client,
                systemPrompt: pass2SystemPrompt,
                messages: contextMessages,
                toolResults,
                onUsage: recordUsage,
              },
              (event) => {
                if (event.type === "chunk") {
                  pass2BufferedContent += event.content;
                  return "continue";
                }

                if (event.type === "error") {
                  runtimeState.auditErrorMessage = event.message;
                  enqueue(event);
                  return "stop";
                }

                return "continue";
              }
            );

            if (pass2Outcome !== "completed") {
              return;
            }
          }

          const groundedToolSummary =
            executionPolicy.groundingPolicy === "verify_tool_summary" &&
            runtimeState.toolCallSucceeded &&
            successfulToolResults.length > 0 &&
            pass2BufferedContent.length > 0;

          if (groundedToolSummary) {
            try {
              await runTimedStage(stageTimings, "grounding", async () => {
                const groundingResult = verifyToolBackedResponseFn({
                  content: pass2BufferedContent,
                  toolResults: successfulToolResults,
                  orgContext: { hideDonorNames },
                });

                if (!groundingResult.grounded) {
                  throw new ToolGroundingVerificationError(groundingResult.failures);
                }
              });
            } catch (error) {
              if (!(error instanceof ToolGroundingVerificationError)) {
                throw error;
              }

              runtimeState.auditErrorMessage = "tool_grounding_failed";
              aiLog("warn", "ai-grounding", "verification failed", {
                ...requestLogContext,
                threadId: threadId!,
              }, {
                messageId: assistantMessageId,
                tools: successfulToolResults.map((result) => result.name),
                failures: error.failures,
              });
              void trackOpsEventServerFn(
                "api_error",
                {
                  endpoint_group: "ai-grounding",
                  http_status: 200,
                  error_code: "tool_grounding_failed",
                  retryable: false,
                },
                ctx.orgId
              );
              pass2BufferedContent = getGroundingFallbackForTools(
                successfulToolResults.map((result) => result.name)
              );
            }
          } else {
            skipStage(stageTimings, "grounding");
          }

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
        const finalMessage = finalizeAssistantMessage({
          fullContent,
          streamCompletedSuccessfully: runtimeState.streamCompletedSuccessfully,
          requestAborted: streamSignal.aborted,
        });
        const finalizeStartedAt = Date.now();
        const { error: finalizeError } = await ctx.supabase
          .from("ai_messages")
          .update({
            content: finalMessage.content,
            status: finalMessage.status,
          })
          .eq("id", assistantMessageId);

        setStageStatus(
          stageTimings,
          "assistant_finalize_write",
          finalizeError ? "failed" : "completed",
          Date.now() - finalizeStartedAt
        );

        if (finalizeError) {
          aiLog("error", "ai-chat", "assistant finalize failed", {
            ...requestLogContext,
            threadId: threadId!,
          }, { error: finalizeError, messageId: assistantMessageId });
          runtimeState.auditErrorMessage ??= "assistant_finalize_failed";
        }

        if (runtimeState.toolCallMade && !cacheBypassReason && executionPolicy.cachePolicy === "lookup_exact") {
          cacheBypassReason = "tool_call_made";
        }

        const canWriteCache =
          runtimeState.streamCompletedSuccessfully &&
          !finalizeError &&
          executionPolicy.cachePolicy === "lookup_exact" &&
          cacheStatus === "miss" &&
          !runtimeState.toolCallMade;

        if (canWriteCache) {
          const cacheWriteResult = await writeCache({
            message: messageSafety.promptSafeMessage,
            orgId: ctx.orgId,
            role: ctx.role,
            surface: effectiveSurface,
            responseContent: fullContent,
            sourceMessageId: assistantMessageId,
            supabase: ctx.serviceSupabase,
            stageTimings,
            logContext: {
              ...requestLogContext,
              threadId: threadId!,
            },
          });

          if (cacheWriteResult.status === "inserted") {
            cacheEntryId = cacheWriteResult.entryId;
          } else if (!cacheBypassReason) {
            cacheBypassReason = cacheWriteResult.bypassReason;
          }
        } else {
          skipStage(stageTimings, "cache_write");
        }

        const requestOutcome = runtimeState.streamCompletedSuccessfully
          ? runtimeState.auditErrorMessage === "tool_grounding_failed"
            ? "tool_grounding_fallback"
            : "completed"
          : streamSignal.aborted
            ? "aborted"
            : runtimeState.auditErrorMessage?.includes("timeout")
              ? "timed_out"
              : "error";

        const modelRefusalDetected =
          fullContent.trim().startsWith(SCOPE_REFUSAL_CANONICAL_PREFIX);
        const finalBypassReason = modelRefusalDetected
          ? cacheBypassReason ?? "scope_refusal"
          : cacheBypassReason;
        const finalAuditError = modelRefusalDetected
          ? runtimeState.auditErrorMessage ?? "scope_refusal:model_refusal_detected"
          : runtimeState.auditErrorMessage;

        await logAiRequestFn(ctx.serviceSupabase, {
          threadId: threadId!,
          messageId: assistantMessageId,
          userId: ctx.userId,
          orgId: ctx.orgId,
          intent: resolvedIntent,
          intentType: resolvedIntentType,
          toolCalls: auditToolCalls.length > 0 ? auditToolCalls : undefined,
          latencyMs: Date.now() - startTime,
          model: process.env.ZAI_API_KEY ? getZaiModelFn() : undefined,
          inputTokens: runtimeState.usage?.inputTokens,
          outputTokens: runtimeState.usage?.outputTokens,
          error: finalAuditError,
          cacheStatus,
          cacheEntryId,
          cacheBypassReason: finalBypassReason,
          contextSurface: (runtimeState.contextMetadata?.surface ?? effectiveSurface) as CacheSurface,
          contextTokenEstimate: runtimeState.contextMetadata?.estimatedTokens,
          ragChunkCount: ragChunkCount > 0 ? ragChunkCount : undefined,
          ragTopSimilarity,
          ragError,
          safetyVerdict: runtimeState.safetyVerdict,
          safetyCategories: runtimeState.safetyCategories,
          safetyLatencyMs: runtimeState.safetyLatencyMs,
          ragGrounded: runtimeState.ragGrounded,
          ragGroundingFailures: runtimeState.ragGroundingFailures,
          ragGroundingLatencyMs: runtimeState.ragGroundingLatencyMs,
          ragGroundingMode: runtimeState.ragGroundingAudited,
          stageTimings: finalizeStageTimings(
            stageTimings,
            requestOutcome,
            Date.now() - startTime
          ),
        }, {
          ...requestLogContext,
          threadId: threadId!,
        });
      }
    }, request.signal);

    return buildSseResponse(stream, { ...SSE_HEADERS, ...rateLimit.headers }, threadId!);
  };
}
