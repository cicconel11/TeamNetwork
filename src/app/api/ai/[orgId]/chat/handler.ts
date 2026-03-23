/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { sendMessageSchema } from "@/lib/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { buildPromptContext } from "@/lib/ai/context-builder";
import { composeResponse, type UsageAccumulator } from "@/lib/ai/response-composer";
import { logAiRequest } from "@/lib/ai/audit";
import { createSSEStream, SSE_HEADERS, type CacheStatus } from "@/lib/ai/sse";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import {
  normalizePrompt,
  hashPrompt,
  buildPermissionScopeKey,
  checkCacheEligibility,
} from "@/lib/ai/semantic-cache-utils";
import { lookupSemanticCache, writeCacheEntry } from "@/lib/ai/semantic-cache";
import { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import type { RagChunkInput } from "@/lib/ai/context-builder";
import { resolveSurfaceRouting } from "@/lib/ai/intent-router";

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
  const routing = resolveSurfaceRouting(message, surface);
  const effectiveSurface = routing.effectiveSurface;
  const resolvedIntent = routing.intent;
  const skipRetrieval = routing.skipRetrieval;

  // Cache state — declared here so both the cache check block and the finally block can access them
  let cacheStatus: CacheStatus = cacheDisabled
    ? "disabled"
    : validatedBody.bypassCache
      ? "bypass"
      : "ineligible";
  let cacheEntryId: string | undefined;
  let cacheBypassReason: string | undefined;
  const eligibility = checkCacheEligibility({
    message,
    threadId: existingThreadId,
    surface: effectiveSurface,
    bypassCache: validatedBody.bypassCache,
  });
  let usesSharedStaticContext = false;

  if (cacheDisabled) {
    cacheBypassReason = "disabled_via_env";
  } else if (!eligibility.eligible) {
    cacheBypassReason = eligibility.reason;
  }

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
        context_surface: effectiveSurface,
        status: input.status,
        content: input.content,
      })
      .select("id")
      .single();

  // 8.5 Semantic cache check
  if (!cacheDisabled && eligibility.eligible) {
    const normalized = normalizePrompt(message);
    const promptHash = hashPrompt(normalized);
    const permissionScopeKey = buildPermissionScopeKey(ctx.orgId, ctx.role);

    const cacheResult = await lookupSemanticCache({
      promptHash,
      orgId: ctx.orgId,
      surface: effectiveSurface,
      permissionScopeKey,
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
          latencyMs: Date.now() - startTime,
          cacheStatus: "hit_exact",
          cacheEntryId: cacheResult.hit.id,
          contextSurface: effectiveSurface,
        });

        return new Response(cachedStream, { headers: { ...SSE_HEADERS, ...rateLimit.headers } });
      }
    } else {
      cacheStatus = cacheResult.reason === "miss" ? "miss" : "error";
      usesSharedStaticContext = cacheResult.reason === "miss";
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
  if (hasEmbeddingKey && !skipRetrieval) {
    try {
      const retrieved = await retrieveRelevantChunksFn({
        query: message,
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
  const stream = createSSEStream(async (enqueue) => {
    let fullContent = "";
    const usageRef: { current: UsageAccumulator | null } = { current: null };
    let streamCompletedSuccessfully = false;
    let auditErrorMessage: string | undefined;
    let contextMetadata: { surface: string; estimatedTokens: number } | undefined;

    try {
      // Guard: ZAI_API_KEY required
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

      // Mark assistant message as streaming
      await ctx.supabase
        .from("ai_messages")
        .update({ intent: resolvedIntent, context_surface: effectiveSurface, status: "streaming" })
        .eq("id", assistantMessageId);

      // Build context and fetch history in parallel
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
          content: m.content as string,
        }));

      const contextMessages = orgContextMessage
        ? [{ role: "user" as const, content: orgContextMessage }, ...historyMessages]
        : historyMessages;

      for await (const event of composeResponseFn({
        client,
        systemPrompt,
        messages: contextMessages,
        onUsage: (u) => { usageRef.current = u; },
      })) {
        if (event.type === "chunk") {
          fullContent += event.content;
          enqueue(event);
        } else if (event.type === "error") {
          auditErrorMessage = event.message;
          enqueue(event);
          return;
        }
      }

      // Done event — include usage if the provider returned it
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
      enqueue({ type: "error", message: "An error occurred", retryable: true });
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

      const canWriteCache =
        streamCompletedSuccessfully &&
        !finalizeError &&
        eligibility.eligible &&
        cacheStatus === "miss";

      if (canWriteCache) {
        const normalized = normalizePrompt(message);
        const promptHash = hashPrompt(normalized);
        const permissionScopeKey = buildPermissionScopeKey(ctx.orgId, ctx.role);

        await writeCacheEntry({
          normalizedPrompt: normalized,
          promptHash,
          responseContent: fullContent,
          orgId: ctx.orgId,
          surface: effectiveSurface,
          permissionScopeKey,
          sourceMessageId: assistantMessageId,
          supabase: ctx.serviceSupabase,
        });
      }

      await logAiRequestFn(ctx.serviceSupabase, {
        threadId: threadId!,
        messageId: assistantMessageId,
        userId: ctx.userId,
        orgId: ctx.orgId,
        intent: resolvedIntent,
        latencyMs: Date.now() - startTime,
        model: process.env.ZAI_API_KEY ? getZaiModelFn() : undefined,
        inputTokens: usageRef.current?.inputTokens,
        outputTokens: usageRef.current?.outputTokens,
        error: auditErrorMessage,
        cacheStatus,
        cacheEntryId,
        cacheBypassReason,
        contextSurface: (contextMetadata?.surface ?? effectiveSurface) as import("@/lib/ai/semantic-cache-utils").CacheSurface,
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
