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
  type UsageAccumulator,
} from "@/lib/ai/response-composer";
import { logAiRequest } from "@/lib/ai/audit";
import { createSSEStream, SSE_HEADERS, type CacheStatus, type SSEEvent } from "@/lib/ai/sse";
import {
  AI_TOOL_MAP,
  type ToolName,
} from "@/lib/ai/tools/definitions";
import { executeToolCall } from "@/lib/ai/tools/executor";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import {
  buildSemanticCacheKeyParts,
  checkCacheEligibility,
  type CacheSurface,
} from "@/lib/ai/semantic-cache-utils";
import { lookupSemanticCache, writeCacheEntry } from "@/lib/ai/semantic-cache";
import { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import type { RagChunkInput } from "@/lib/ai/context-builder";
import { resolveSurfaceRouting } from "@/lib/ai/intent-router";
import {
  buildTurnExecutionPolicy,
  type TurnExecutionPolicy,
} from "@/lib/ai/turn-execution-policy";
import {
  verifyToolBackedResponse,
  type SuccessfulToolSummary,
} from "@/lib/ai/tool-grounding";
import { trackOpsEventServer } from "@/lib/analytics/events-server";
import {
  assessAiMessageSafety,
  sanitizeHistoryMessageForPrompt,
} from "@/lib/ai/message-safety";
import {
  createStageAbortSignal,
  isStageTimeoutError,
  PASS1_MODEL_TIMEOUT_MS,
  PASS2_MODEL_TIMEOUT_MS,
} from "@/lib/ai/timeout";

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
  trackOpsEventServer?: typeof trackOpsEventServer;
}

const PASS1_TOOL_NAMES: Record<CacheSurface, ToolName[]> = {
  general: ["list_members", "list_events", "get_org_stats", "suggest_connections"],
  members: ["list_members", "get_org_stats", "suggest_connections"],
  analytics: ["get_org_stats"],
  events: ["list_events", "get_org_stats"],
};

const CONNECTION_PROMPT_PATTERN =
  /(?<!\w)(?:connection|connections|connect|networking|introduc(?:e|tion))(?!\w)/i;

const CONNECTION_PASS2_TEMPLATE = [
  "CONNECTION ANSWER CONTRACT:",
  "- If suggest_connections returned state=resolved, respond using this exact shape:",
  "  Who [source person name] should connect with",
  "  1. [suggestion name] - [subtitle if present]",
  "  Why: [reason], [reason], [reason]",
  "- Use at most 3 suggestions.",
  "- Use only the returned source_person, suggestions, subtitles, and normalized reason labels.",
  "- Do not mention scores, UUIDs, Falkor, SQL fallback, freshness, or internal tool details.",
  "- If state=ambiguous, ask the user which returned option they mean.",
  "- If state=not_found, say you couldn't find that person in the organization's member or alumni data and ask for a narrower identifier.",
  "- If state=no_suggestions, say you found the person but do not have supported connection recommendations yet.",
].join("\n");

function getPass1Tools(
  message: string,
  effectiveSurface: CacheSurface,
  toolPolicy: TurnExecutionPolicy["toolPolicy"]
) {
  if (toolPolicy !== "surface_read_tools") {
    return undefined;
  }

  if (effectiveSurface === "members" && CONNECTION_PROMPT_PATTERN.test(message)) {
    return [AI_TOOL_MAP.suggest_connections];
  }

  return PASS1_TOOL_NAMES[effectiveSurface].map((toolName) => AI_TOOL_MAP[toolName]);
}

function recordStageFailure(stage: string, failureKind: string) {
  console.warn("[ai-chat] stage failure", { stage, failure_kind: failureKind });
}

const MESSAGE_SAFETY_FALLBACK =
  "I can’t help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your organization’s data instead.";

const TOOL_GROUNDING_FALLBACK =
  "I couldn’t verify that answer against your organization’s data, so I’m not returning it. Please try rephrasing or ask a narrower question.";

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
  const trackOpsEventServerFn = deps.trackOpsEventServer ?? trackOpsEventServer;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;
    const startTime = Date.now();
    const cacheDisabled = process.env.DISABLE_AI_CACHE === "true";

  // 1. Rate limit — get user first to allow per-user limiting
  const supabase = await createClientFn();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(request, {
    userId: user?.id ?? null,
    feature: "ai-chat",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  // 2. Auth — validate admin role
  const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
  if (!ctx.ok) return ctx.response;

  // 3. Validate body
  let validatedBody: ReturnType<typeof sendMessageSchema.parse> extends infer T ? T : never;
  try {
    validatedBody = await validateJson(request, sendMessageSchema);
  } catch (err) {
    if (err instanceof ValidationError) {
      return validationErrorResponse(err);
    }
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const { message, surface, threadId: existingThreadId, idempotencyKey } = validatedBody;
  const messageSafety = assessAiMessageSafety(message);
  const routing = resolveSurfaceRouting(messageSafety.promptSafeMessage, surface);
  const effectiveSurface = routing.effectiveSurface;
  const resolvedIntent = routing.intent;
  const resolvedIntentType = routing.intentType;
  const requestNow = new Date().toISOString();
  const requestTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  // Cache state — declared here so both the cache check block and the finally block can access them
  let cacheStatus: CacheStatus = cacheDisabled
    ? "disabled"
    : validatedBody.bypassCache
      ? "bypass"
      : "ineligible";
  let cacheEntryId: string | undefined;
  let cacheBypassReason: string | undefined;
  const eligibility = checkCacheEligibility({
    message: messageSafety.promptSafeMessage,
    threadId: existingThreadId,
    surface: effectiveSurface,
    bypassCache: validatedBody.bypassCache,
  });
  const executionPolicy = buildTurnExecutionPolicyFn({
    message: messageSafety.promptSafeMessage,
    threadId: existingThreadId,
    requestedSurface: surface,
    routing,
    cacheEligibility: eligibility,
  });
  const usesSharedStaticContext =
    executionPolicy.contextPolicy === "shared_static";

  if (cacheDisabled && executionPolicy.cachePolicy === "lookup_exact") {
    cacheStatus = "disabled";
    cacheBypassReason = "disabled_via_env";
  } else if (executionPolicy.cachePolicy === "skip") {
    cacheBypassReason =
      executionPolicy.profile === "casual"
        ? "casual_turn"
        : executionPolicy.profile === "out_of_scope"
          ? "out_of_scope_request"
          : eligibility.eligible
            ? executionPolicy.reasons[0]
            : eligibility.reason;
  } else if (!eligibility.eligible) {
    cacheBypassReason = eligibility.reason;
  }
  const skipRagRetrieval = executionPolicy.retrievalPolicy === "skip";
  const pass1Tools = getPass1Tools(
    messageSafety.promptSafeMessage,
    effectiveSurface,
    executionPolicy.toolPolicy
  );

  // 4. Validate provided thread ownership before any cleanup or writes
  let threadId = existingThreadId;
  if (threadId) {
    const resolution = await resolveOwnThreadFn(
      threadId,
      ctx.userId,
      ctx.orgId,
      ctx.serviceSupabase
    );
    if (!resolution.ok) {
      return NextResponse.json(
        { error: resolution.message },
        { status: resolution.status, headers: rateLimit.headers }
      );
    }
  }

  // 5. Abandoned stream cleanup (5-min threshold)
  if (existingThreadId) {
    const { error: cleanupError } = await ctx.supabase
      .from("ai_messages")
      .update({ status: "error", content: "[abandoned]" })
      .eq("thread_id", existingThreadId)
      .eq("role", "assistant")
      .in("status", ["pending", "streaming"])
      .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if (cleanupError) {
      console.error("[ai-chat] abandoned stream cleanup failed:", cleanupError);
    }
  }

  // 6. Idempotency check — look up by idempotency_key
  const { data: existingMsg, error: idempError } = await ctx.supabase
    .from("ai_messages")
    .select("id, status, thread_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (idempError) {
    console.error("[ai-chat] idempotency check failed:", idempError);
    return NextResponse.json({ error: "Failed to check message idempotency" }, { status: 500 });
  }

  if (existingMsg) {
    if (existingMsg.status === "complete") {
      // Replay: fetch the assistant response content for this thread
      const { data: assistantReplay } = await ctx.supabase
        .from("ai_messages")
        .select("content")
        .eq("thread_id", existingMsg.thread_id)
        .eq("role", "assistant")
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      return new Response(
        createSSEStream(async (enqueue) => {
          if (assistantReplay?.content) {
            enqueue({ type: "chunk", content: assistantReplay.content });
          }
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
        { headers: { ...SSE_HEADERS, ...rateLimit.headers } }
      );
    }
    // In-flight — return 409 to signal duplicate
    return NextResponse.json(
      { error: "Request already in progress", threadId: existingMsg.thread_id },
      { status: 409, headers: rateLimit.headers }
    );
  }

  // 7+8. Atomically create/reuse thread and insert user message via RPC
  const { data: initResult, error: initError } = await (ctx.serviceSupabase as any).rpc(
    "init_ai_chat",
    {
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
    }
  );

  if (initError || !initResult) {
    console.error("[ai-chat] init_ai_chat RPC failed:", initError);
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

    const { data: safetyAssistantMsg, error: safetyAssistantError } =
      await insertAssistantMessage({
        content: MESSAGE_SAFETY_FALLBACK,
        status: "complete",
      });

    if (safetyAssistantError || !safetyAssistantMsg) {
      console.error("[ai-chat] safety assistant message failed:", safetyAssistantError);
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
    });

    return new Response(
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
      { headers: { ...SSE_HEADERS, ...rateLimit.headers } }
    );
  }

  // 8.5 Semantic cache check
  if (!cacheDisabled && executionPolicy.cachePolicy === "lookup_exact") {
    const cacheKey = buildSemanticCacheKeyParts({
      message: messageSafety.promptSafeMessage,
      orgId: ctx.orgId,
      role: ctx.role,
    });

    const cacheResult = await lookupSemanticCache({
      cacheKey,
      orgId: ctx.orgId,
      surface: effectiveSurface,
      supabase: ctx.serviceSupabase,
    });

    if (cacheResult.ok) {
      cacheStatus = "hit_exact";
      cacheEntryId = cacheResult.hit.id;

      // Insert assistant message with cached content already complete
      const { data: cachedAssistantMsg, error: cachedAssistantError } =
        await insertAssistantMessage({
          content: cacheResult.hit.responseContent,
          status: "complete",
        });

      if (cachedAssistantError || !cachedAssistantMsg) {
        console.error("[ai-chat] cache hit assistant message failed:", cachedAssistantError);
        cacheStatus = "error";
        cacheBypassReason = "cache_hit_persist_failed";
        // Fall through to live path
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
        });

        return new Response(cachedStream, { headers: { ...SSE_HEADERS, ...rateLimit.headers } });
      }
    } else {
      cacheStatus = cacheResult.reason === "miss" ? "miss" : "error";
      if (cacheResult.reason === "error") {
        cacheBypassReason = "cache_lookup_failed";
      }
    }
  }

  // 8.6 RAG retrieval — additive, never blocking
  let ragChunks: RagChunkInput[] = [];
  let ragChunkCount = 0;
  let ragTopSimilarity: number | undefined;
  let ragError: string | undefined;

  const hasEmbeddingKey = !!process.env.EMBEDDING_API_KEY;
  if (hasEmbeddingKey && !skipRagRetrieval) {
    try {
      const retrieved = await retrieveRelevantChunksFn({
        query: messageSafety.promptSafeMessage,
        orgId: ctx.orgId,
        serviceSupabase: ctx.serviceSupabase,
      });
      ragChunkCount = retrieved.length;
      if (retrieved.length > 0) {
        ragTopSimilarity = Math.max(...retrieved.map((c) => c.similarity));
        ragChunks = retrieved.map((c) => ({
          contentText: c.contentText,
          sourceTable: c.sourceTable,
          metadata: c.metadata,
        }));
      }
    } catch (err) {
      ragError = err instanceof Error ? err.message : "rag_retrieval_failed";
      console.error("[ai-chat] RAG retrieval failed (continuing without):", err);
    }
  }

  // 9. Insert assistant placeholder
  const { data: assistantMsg, error: assistantError } = await insertAssistantMessage({
    content: null,
    status: "pending",
  });

  if (assistantError || !assistantMsg) {
    console.error("[ai-chat] assistant placeholder failed:", assistantError);
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
    const usageRef: { current: UsageAccumulator | null } = { current: null };
    let streamCompletedSuccessfully = false;
    let auditErrorMessage: string | undefined;
    let contextMetadata: { surface: string; estimatedTokens: number } | undefined;
    let toolCallMade = false;
    let toolCallSucceeded = false;
    let terminateTurn = false;
    let toolPassBreakerOpen = false;
    const auditToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const successfulToolResults: SuccessfulToolSummary[] = [];
    const recordUsage = (usage: UsageAccumulator) => {
      usageRef.current = {
        inputTokens: (usageRef.current?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (usageRef.current?.outputTokens ?? 0) + usage.outputTokens,
      };
    };
    const emitTimeoutError = () =>
      enqueue({
        type: "error",
        message: "The response timed out. Please try again.",
        retryable: true,
      });
    const runModelStage = async (
      stage: "pass1_model" | "pass2_model",
      timeoutMs: number,
      options: Parameters<typeof composeResponseFn>[0],
      onEvent: (event: SSEEvent | ToolCallRequestedEvent) => Promise<"continue" | "stop"> | "continue" | "stop"
    ): Promise<"completed" | "stopped" | "timeout" | "aborted"> => {
      const stageSignal = createStageAbortSignal({
        stage,
        timeoutMs,
        parentSignal: streamSignal,
      });

      try {
        for await (const event of composeResponseFn({
          ...options,
          signal: stageSignal.signal,
        })) {
          const disposition = await onEvent(event as SSEEvent | ToolCallRequestedEvent);
          if (disposition === "stop") {
            return "stopped";
          }
        }
        return "completed";
      } catch (err) {
        const failureReason = stageSignal.signal.reason ?? err;
        if (isStageTimeoutError(failureReason)) {
          recordStageFailure(stage, "timeout");
          auditErrorMessage = `${stage}:timeout`;
          emitTimeoutError();
          return "timeout";
        }
        if (streamSignal.aborted || stageSignal.signal.aborted) {
          recordStageFailure(stage, "request_aborted");
          auditErrorMessage = `${stage}:request_aborted`;
          return "aborted";
        }
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
        streamCompletedSuccessfully = true;
        return;
      }

      const client = createZaiClientFn();

      await ctx.supabase
        .from("ai_messages")
        .update({
          intent: resolvedIntent,
          intent_type: resolvedIntentType,
          context_surface: effectiveSurface,
          status: "streaming",
        })
        .eq("id", assistantMessageId);

      const [contextResult, { data: history, error: historyError }] =
        await Promise.all([
          buildPromptContextFn({
            orgId: ctx.orgId,
            userId: ctx.userId,
            role: ctx.role,
            serviceSupabase: ctx.serviceSupabase,
            contextMode: usesSharedStaticContext ? "shared_static" : "full",
            surface: effectiveSurface,
            ragChunks: ragChunks.length > 0 ? ragChunks : undefined,
            now: requestNow,
            timeZone: requestTimeZone,
          }),
          ctx.supabase
            .from("ai_messages")
            .select("role, content")
            .eq("thread_id", threadId)
            .eq("status", "complete")
            .order("created_at", { ascending: true })
            .limit(20),
        ]);

      const { systemPrompt, orgContextMessage, metadata } = contextResult;
      contextMetadata = metadata;

      if (historyError) {
        console.error("[ai-chat] history fetch failed:", historyError);
        enqueue({ type: "error", message: "Failed to load conversation history", retryable: true });
        return;
      }

      const historyMessages = (history ?? [])
        .filter((m: any) => m.content)
        .map((m: any) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "user"
              ? sanitizeHistoryMessageForPrompt(m.content as string).promptSafeMessage
              : (m.content as string),
        }))
        .filter((m: { content: string }) => Boolean(m.content));

      const contextMessages = orgContextMessage
        ? [{ role: "user" as const, content: orgContextMessage }, ...historyMessages]
        : historyMessages;

      const toolResults: ToolResultMessage[] = [];
      const pass1Outcome = await runModelStage(
        "pass1_model",
        PASS1_MODEL_TIMEOUT_MS,
        {
          client,
          systemPrompt,
          messages: contextMessages,
          tools: pass1Tools,
          onUsage: recordUsage,
        },
        async (event) => {
          if (event.type === "chunk") {
            if (pass1Tools) {
              pass1BufferedContent += event.content;
            } else {
              fullContent += event.content;
              enqueue(event);
            }
            return "continue";
          }

          if (event.type === "error") {
            auditErrorMessage = event.message;
            enqueue(event);
            return "stop";
          }

          const toolEvent = event as ToolCallRequestedEvent;
          toolCallMade = true;

          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(toolEvent.argsJson);
          } catch {
            recordStageFailure(`tool_${toolEvent.name}`, "tool_error");
            enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
            auditToolCalls.push({ name: toolEvent.name, args: {} });
            toolResults.push({
              toolCallId: toolEvent.id,
              name: toolEvent.name,
              args: {},
              data: { error: "Malformed tool arguments" },
            });
            return "continue";
          }

          auditToolCalls.push({ name: toolEvent.name, args: parsedArgs });

          if (toolPassBreakerOpen) {
            return "continue";
          }

          enqueue({ type: "tool_status", toolName: toolEvent.name, status: "calling" });

          const result = await executeToolCallFn(
            { orgId: ctx.orgId, userId: ctx.userId, serviceSupabase: ctx.serviceSupabase },
            { name: toolEvent.name, args: parsedArgs }
          );

          switch (result.kind) {
            case "ok":
              enqueue({ type: "tool_status", toolName: toolEvent.name, status: "done" });
              toolCallSucceeded = true;
              toolResults.push({
                toolCallId: toolEvent.id,
                name: toolEvent.name,
                args: parsedArgs,
                data: result.data,
              });
              successfulToolResults.push({
                name: toolEvent.name as ToolName,
                data: result.data,
              });
              return "continue";
            case "tool_error":
              recordStageFailure(`tool_${toolEvent.name}`, "tool_error");
              enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
              toolResults.push({
                toolCallId: toolEvent.id,
                name: toolEvent.name,
                args: parsedArgs,
                data: { error: result.error },
              });
              return "continue";
            case "timeout":
              recordStageFailure(`tool_${toolEvent.name}`, "timeout");
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
              recordStageFailure(`tool_${toolEvent.name}`, result.kind);
              enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
              auditErrorMessage = `tool_${toolEvent.name}:${result.kind}`;
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
        return;
      }

      if (!toolCallMade && pass1Tools && pass1BufferedContent) {
        fullContent += pass1BufferedContent;
        enqueue({ type: "chunk", content: pass1BufferedContent });
      }

      if (toolCallMade && toolResults.length > 0) {
        const pass2SystemPrompt = successfulToolResults.some(
          (result) => result.name === "suggest_connections"
        )
          ? `${systemPrompt}\n\n${CONNECTION_PASS2_TEMPLATE}`
          : systemPrompt;

        const pass2Outcome = await runModelStage(
          "pass2_model",
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
              auditErrorMessage = event.message;
              enqueue(event);
              return "stop";
            }

            return "continue";
          }
        );

        if (pass2Outcome !== "completed") {
          return;
        }

        const groundedToolSummary =
          executionPolicy.groundingPolicy === "verify_tool_summary" &&
          toolCallSucceeded &&
          successfulToolResults.length > 0;

        if (groundedToolSummary) {
          const groundingResult = verifyToolBackedResponseFn({
            content: pass2BufferedContent,
            toolResults: successfulToolResults,
          });

          if (!groundingResult.grounded) {
            auditErrorMessage = "tool_grounding_failed";
            console.warn("[ai-grounding] verification failed:", {
              orgId: ctx.orgId,
              threadId,
              messageId: assistantMessageId,
              tools: successfulToolResults.map((result) => result.name),
              failures: groundingResult.failures,
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
            pass2BufferedContent = TOOL_GROUNDING_FALLBACK;
          }
        }

        if (pass2BufferedContent) {
          fullContent += pass2BufferedContent;
          enqueue({ type: "chunk", content: pass2BufferedContent });
        }
      }

      const usage = usageRef.current;
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
      streamCompletedSuccessfully = true;
    } catch (err) {
      console.error("[ai-chat] stream error:", err);
      auditErrorMessage = err instanceof Error ? err.message : "stream_failed";
      if (!streamSignal.aborted) {
        enqueue({ type: "error", message: "An error occurred", retryable: true });
      }
    } finally {
      // Update assistant message row to final state
      const finalStatus = streamCompletedSuccessfully ? "complete" : "error";
      const finalContent = streamCompletedSuccessfully ? fullContent : fullContent || "[error]";

      const { error: finalizeError } = await ctx.supabase
        .from("ai_messages")
        .update({
          content: finalContent,
          status: finalStatus,
        })
        .eq("id", assistantMessageId);

      if (finalizeError) {
        console.error("[ai-chat] assistant finalize failed:", finalizeError);
        auditErrorMessage ??= "assistant_finalize_failed";
      }

      // Tool calls bypass cache — response depends on live data
      if (toolCallMade && !cacheBypassReason && executionPolicy.cachePolicy === "lookup_exact") {
        cacheBypassReason = "tool_call_made";
      }

      const canWriteCache =
        streamCompletedSuccessfully &&
        !finalizeError &&
        executionPolicy.cachePolicy === "lookup_exact" &&
        cacheStatus === "miss" &&
        !toolCallMade;

      if (canWriteCache) {
        const cacheKey = buildSemanticCacheKeyParts({
          message: messageSafety.promptSafeMessage,
          orgId: ctx.orgId,
          role: ctx.role,
        });

        const cacheWriteResult = await writeCacheEntry({
          cacheKey,
          responseContent: fullContent,
          orgId: ctx.orgId,
          surface: effectiveSurface,
          sourceMessageId: assistantMessageId,
          supabase: ctx.serviceSupabase,
        });

        if (cacheWriteResult.status === "inserted") {
          cacheEntryId = cacheWriteResult.entryId;
        } else if (cacheWriteResult.status === "duplicate" && !cacheBypassReason) {
          cacheBypassReason = "cache_write_duplicate";
        } else if (
          cacheWriteResult.status === "skipped_too_large" &&
          !cacheBypassReason
        ) {
          cacheBypassReason = "cache_write_skipped_too_large";
        } else if (cacheWriteResult.status === "error" && !cacheBypassReason) {
          cacheBypassReason = "cache_write_failed";
        }
      }

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
        inputTokens: usageRef.current?.inputTokens,
        outputTokens: usageRef.current?.outputTokens,
        error: auditErrorMessage,
        cacheStatus,
        cacheEntryId,
        cacheBypassReason,
        contextSurface: (contextMetadata?.surface ?? effectiveSurface) as CacheSurface,
        contextTokenEstimate: contextMetadata?.estimatedTokens,
        ragChunkCount: ragChunkCount > 0 ? ragChunkCount : undefined,
        ragTopSimilarity,
        ragError,
      });
    }
  }, request.signal);

    return new Response(stream, { headers: { ...SSE_HEADERS, ...rateLimit.headers } });
  };
}
