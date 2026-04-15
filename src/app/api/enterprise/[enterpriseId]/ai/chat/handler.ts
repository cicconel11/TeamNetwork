/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEnterpriseAiContext } from "@/lib/ai/enterprise-context";
import { sendEnterpriseMessageSchema } from "@/lib/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, validationErrorResponse, ValidationError } from "@/lib/security/validation";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { buildEnterprisePromptContext } from "@/lib/ai/enterprise-context-builder";
import {
  composeResponse,
  type ToolCallRequestedEvent,
  type ToolResultMessage,
  type UsageAccumulator,
} from "@/lib/ai/response-composer";
import { logAiRequest } from "@/lib/ai/audit";
import { createSSEStream, SSE_HEADERS, type SSEEvent } from "@/lib/ai/sse";
import { ENTERPRISE_AI_TOOLS } from "@/lib/ai/tools/enterprise-definitions";
import { executeEnterpriseToolCall } from "@/lib/ai/tools/enterprise-executor";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import { assessAiMessageSafety, sanitizeHistoryMessageForPrompt } from "@/lib/ai/message-safety";
import {
  createStageAbortSignal,
  isStageTimeoutError,
  PASS1_MODEL_TIMEOUT_MS,
  PASS2_MODEL_TIMEOUT_MS,
} from "@/lib/ai/timeout";

/**
 * Enterprise AI chat handler — sibling of org chat handler. Phase 1: minimal,
 * read-only. No semantic cache (Phase 2). No surface routing (single fixed
 * "enterprise" surface). No RAG (Phase 2).
 */

export interface EnterpriseChatRouteDeps {
  createClient?: typeof createClient;
  getEnterpriseAiContext?: typeof getEnterpriseAiContext;
  buildEnterprisePromptContext?: typeof buildEnterprisePromptContext;
  createZaiClient?: typeof createZaiClient;
  getZaiModel?: typeof getZaiModel;
  composeResponse?: typeof composeResponse;
  logAiRequest?: typeof logAiRequest;
  resolveOwnThread?: typeof resolveOwnThread;
  executeEnterpriseToolCall?: typeof executeEnterpriseToolCall;
}

const MESSAGE_SAFETY_FALLBACK =
  "I can't help with instructions about hidden prompts, internal tools, or overriding safety rules. Ask a question about your enterprise instead.";

function recordStageFailure(stage: string, kind: string) {
  console.warn("[ai-ent-chat] stage failure", { stage, failure_kind: kind });
}

export function createEnterpriseChatPostHandler(deps: EnterpriseChatRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getCtxFn = deps.getEnterpriseAiContext ?? getEnterpriseAiContext;
  const buildPromptFn = deps.buildEnterprisePromptContext ?? buildEnterprisePromptContext;
  const createZaiClientFn = deps.createZaiClient ?? createZaiClient;
  const getZaiModelFn = deps.getZaiModel ?? getZaiModel;
  const composeFn = deps.composeResponse ?? composeResponse;
  const logFn = deps.logAiRequest ?? logAiRequest;
  const resolveOwnThreadFn = deps.resolveOwnThread ?? resolveOwnThread;
  const executeFn = deps.executeEnterpriseToolCall ?? executeEnterpriseToolCall;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ enterpriseId: string }> }
  ) {
    const { enterpriseId: idOrSlug } = await params;
    const startTime = Date.now();

    // 1. Rate limit (per-user)
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

    // 2. Auth — validates user_enterprise_roles membership
    const ctx = await getCtxFn(idOrSlug, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;

    // 3. Validate body
    let body: ReturnType<typeof sendEnterpriseMessageSchema.parse> extends infer T ? T : never;
    try {
      body = await validateJson(request, sendEnterpriseMessageSchema);
    } catch (err) {
      if (err instanceof ValidationError) return validationErrorResponse(err);
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const { message, threadId: existingThreadId, idempotencyKey } = body;
    const messageSafety = assessAiMessageSafety(message);
    const requestNow = new Date().toISOString();
    const requestTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

    // 4. Validate provided thread ownership before any writes
    let threadId = existingThreadId;
    if (threadId) {
      const resolution = await resolveOwnThreadFn(
        threadId,
        ctx.userId,
        { scope: "enterprise", enterpriseId: ctx.enterpriseId },
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
    if (existingThreadId && ctx.supabase) {
      const { error: cleanupError } = await ctx.supabase
        .from("ai_messages")
        .update({ status: "error", content: "[abandoned]" })
        .eq("thread_id", existingThreadId)
        .eq("role", "assistant")
        .in("status", ["pending", "streaming"])
        .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
      if (cleanupError) {
        console.error("[ai-ent-chat] abandoned cleanup failed:", cleanupError);
      }
    }

    // 6. Idempotency check (enterprise scope)
    const sb = ctx.supabase ?? ctx.serviceSupabase;
    const { data: existingMsg, error: idempError } = await sb
      .from("ai_messages")
      .select("id, status, thread_id")
      .eq("idempotency_key", idempotencyKey)
      .eq("enterprise_id", ctx.enterpriseId)
      .is("org_id", null)
      .maybeSingle();

    if (idempError) {
      console.error("[ai-ent-chat] idempotency check failed:", idempError);
      return NextResponse.json(
        { error: "Failed to check message idempotency" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    if (existingMsg) {
      if (existingMsg.status === "complete") {
        const { data: replay } = await sb
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
            if (replay?.content) enqueue({ type: "chunk", content: replay.content });
            enqueue({ type: "done", threadId: existingMsg.thread_id, replayed: true });
          }),
          { headers: { ...SSE_HEADERS, ...rateLimit.headers } }
        );
      }
      return NextResponse.json(
        { error: "Request already in progress", threadId: existingMsg.thread_id },
        { status: 409, headers: rateLimit.headers }
      );
    }

    // 7. Init thread + insert user message via enterprise RPC
    const { data: initResult, error: initError } = await (ctx.serviceSupabase as any).rpc(
      "init_ai_chat_enterprise",
      {
        p_user_id: ctx.userId,
        p_enterprise_id: ctx.enterpriseId,
        p_surface: "enterprise",
        p_title: message.slice(0, 100),
        p_message: message,
        p_idempotency_key: idempotencyKey,
        p_thread_id: threadId ?? null,
      }
    );

    if (initError || !initResult) {
      console.error("[ai-ent-chat] init_ai_chat_enterprise RPC failed:", initError);
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
      sb
        .from("ai_messages")
        .insert({
          thread_id: threadId,
          enterprise_id: ctx.enterpriseId,
          org_id: null,
          user_id: ctx.userId,
          role: "assistant",
          context_surface: "enterprise",
          status: input.status,
          content: input.content,
        })
        .select("id")
        .single();

    // 8. Safety short-circuit
    if (messageSafety.riskLevel !== "none") {
      const { data: safetyMsg, error: safetyErr } = await insertAssistantMessage({
        content: MESSAGE_SAFETY_FALLBACK,
        status: "complete",
      });

      if (safetyErr || !safetyMsg) {
        console.error("[ai-ent-chat] safety message insert failed:", safetyErr);
        return NextResponse.json(
          { error: "Failed to create response" },
          { status: 500, headers: rateLimit.headers }
        );
      }

      await logFn(ctx.serviceSupabase, {
        threadId: threadId!,
        messageId: safetyMsg.id,
        userId: ctx.userId,
        userEmail: ctx.userEmail,
        scope: { scope: "enterprise", enterpriseId: ctx.enterpriseId },
        latencyMs: Date.now() - startTime,
        error: `message_safety_${messageSafety.riskLevel}:${messageSafety.reasons.join(",")}`,
      });

      return new Response(
        createSSEStream(async (enqueue) => {
          enqueue({ type: "chunk", content: MESSAGE_SAFETY_FALLBACK });
          enqueue({ type: "done", threadId: threadId! });
        }),
        { headers: { ...SSE_HEADERS, ...rateLimit.headers } }
      );
    }

    // 9. Insert assistant placeholder
    const { data: assistantMsg, error: assistantErr } = await insertAssistantMessage({
      content: null,
      status: "pending",
    });

    if (assistantErr || !assistantMsg) {
      console.error("[ai-ent-chat] assistant placeholder failed:", assistantErr);
      return NextResponse.json(
        { error: "Failed to create response" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    const assistantMessageId = assistantMsg.id;

    // 10. Stream SSE response with two-pass tool calling
    const stream = createSSEStream(async (enqueue, streamSignal) => {
      let fullContent = "";
      let pass1Buffered = "";
      let pass2Buffered = "";
      const usageRef: { current: UsageAccumulator | null } = { current: null };
      let streamCompleted = false;
      let auditError: string | undefined;
      let toolCallMade = false;
      let terminate = false;
      const auditToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

      const recordUsage = (usage: UsageAccumulator) => {
        usageRef.current = {
          inputTokens: (usageRef.current?.inputTokens ?? 0) + usage.inputTokens,
          outputTokens: (usageRef.current?.outputTokens ?? 0) + usage.outputTokens,
        };
      };

      const runStage = async (
        stage: "pass1_model" | "pass2_model",
        timeoutMs: number,
        options: Parameters<typeof composeFn>[0],
        onEvent: (
          event: SSEEvent | ToolCallRequestedEvent
        ) => Promise<"continue" | "stop"> | "continue" | "stop"
      ): Promise<"completed" | "stopped" | "timeout" | "aborted"> => {
        const stageSignal = createStageAbortSignal({
          stage,
          timeoutMs,
          parentSignal: streamSignal,
        });
        try {
          for await (const event of composeFn({ ...options, signal: stageSignal.signal })) {
            const disposition = await onEvent(event as SSEEvent | ToolCallRequestedEvent);
            if (disposition === "stop") return "stopped";
          }
          return "completed";
        } catch (err) {
          const reason = stageSignal.signal.reason ?? err;
          if (isStageTimeoutError(reason)) {
            recordStageFailure(stage, "timeout");
            auditError = `${stage}:timeout`;
            enqueue({ type: "error", message: "The response timed out. Please try again.", retryable: true });
            return "timeout";
          }
          if (streamSignal.aborted || stageSignal.signal.aborted) {
            recordStageFailure(stage, "request_aborted");
            auditError = `${stage}:request_aborted`;
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
          enqueue({ type: "done", threadId: threadId! });
          streamCompleted = true;
          return;
        }

        const client = createZaiClientFn();

        if (ctx.supabase) {
          await ctx.supabase
            .from("ai_messages")
            .update({ context_surface: "enterprise", status: "streaming" })
            .eq("id", assistantMessageId);
        }

        const [{ systemPrompt, orgContextMessage }, { data: history, error: historyErr }] =
          await Promise.all([
            buildPromptFn({
              enterpriseId: ctx.enterpriseId,
              userId: ctx.userId,
              role: ctx.role,
              serviceSupabase: ctx.serviceSupabase,
              now: requestNow,
              timeZone: requestTimeZone,
            }),
            sb
              .from("ai_messages")
              .select("role, content")
              .eq("thread_id", threadId)
              .eq("status", "complete")
              .order("created_at", { ascending: true })
              .limit(20),
          ]);

        if (historyErr) {
          console.error("[ai-ent-chat] history fetch failed:", historyErr);
          enqueue({
            type: "error",
            message: "Failed to load conversation history",
            retryable: true,
          });
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

        const pass1Outcome = await runStage(
          "pass1_model",
          PASS1_MODEL_TIMEOUT_MS,
          {
            client,
            systemPrompt,
            messages: contextMessages,
            tools: [...ENTERPRISE_AI_TOOLS],
            onUsage: recordUsage,
          },
          async (event) => {
            if (event.type === "chunk") {
              pass1Buffered += event.content;
              return "continue";
            }
            if (event.type === "error") {
              auditError = event.message;
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
            enqueue({ type: "tool_status", toolName: toolEvent.name, status: "calling" });

            // Server-validated ctx wins. Zod .strict() in executor strips
            // any LLM-supplied enterprise_id / actor_user_id.
            const result = await executeFn(
              {
                enterpriseId: ctx.enterpriseId,
                userId: ctx.userId,
                serviceSupabase: ctx.serviceSupabase,
              },
              { name: toolEvent.name, args: parsedArgs }
            );

            switch (result.kind) {
              case "ok":
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "done" });
                toolResults.push({
                  toolCallId: toolEvent.id,
                  name: toolEvent.name,
                  args: parsedArgs,
                  data: result.data,
                });
                return "continue";
              case "tool_error":
              case "timeout":
                recordStageFailure(`tool_${toolEvent.name}`, result.kind);
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                toolResults.push({
                  toolCallId: toolEvent.id,
                  name: toolEvent.name,
                  args: parsedArgs,
                  data: { error: result.error },
                });
                return "continue";
              case "forbidden":
              case "auth_error":
                recordStageFailure(`tool_${toolEvent.name}`, result.kind);
                enqueue({ type: "tool_status", toolName: toolEvent.name, status: "error" });
                auditError = `tool_${toolEvent.name}:${result.kind}`;
                terminate = true;
                enqueue({
                  type: "error",
                  message:
                    result.kind === "forbidden"
                      ? "Your enterprise access has changed."
                      : "Unable to verify enterprise access right now.",
                  retryable: false,
                });
                return "stop";
            }
          }
        );

        if (terminate || pass1Outcome !== "completed") return;

        if (!toolCallMade) {
          // No tool calls — flush pass1 buffer to user
          if (pass1Buffered) {
            fullContent += pass1Buffered;
            enqueue({ type: "chunk", content: pass1Buffered });
          }
        } else if (toolResults.length > 0) {
          const pass2Outcome = await runStage(
            "pass2_model",
            PASS2_MODEL_TIMEOUT_MS,
            {
              client,
              systemPrompt,
              messages: contextMessages,
              toolResults,
              onUsage: recordUsage,
            },
            (event) => {
              if (event.type === "chunk") {
                pass2Buffered += event.content;
                return "continue";
              }
              if (event.type === "error") {
                auditError = event.message;
                enqueue(event);
                return "stop";
              }
              return "continue";
            }
          );

          if (pass2Outcome !== "completed") return;

          if (pass2Buffered) {
            fullContent += pass2Buffered;
            enqueue({ type: "chunk", content: pass2Buffered });
          }
        }

        const usage = usageRef.current;
        enqueue({
          type: "done",
          threadId: threadId!,
          ...(usage
            ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } }
            : {}),
        });
        streamCompleted = true;
      } catch (err) {
        console.error("[ai-ent-chat] stream error:", err);
        auditError = err instanceof Error ? err.message : "stream_failed";
        if (!streamSignal.aborted) {
          enqueue({ type: "error", message: "An error occurred", retryable: true });
        }
      } finally {
        const finalStatus = streamCompleted ? "complete" : "error";
        const finalContent = streamCompleted ? fullContent : fullContent || "[error]";

        if (ctx.supabase) {
          const { error: finalizeErr } = await ctx.supabase
            .from("ai_messages")
            .update({ content: finalContent, status: finalStatus })
            .eq("id", assistantMessageId);
          if (finalizeErr) {
            console.error("[ai-ent-chat] assistant finalize failed:", finalizeErr);
            auditError ??= "assistant_finalize_failed";
          }
        }

        await logFn(ctx.serviceSupabase, {
          threadId: threadId!,
          messageId: assistantMessageId,
          userId: ctx.userId,
          userEmail: ctx.userEmail,
          scope: { scope: "enterprise", enterpriseId: ctx.enterpriseId },
          toolCalls: auditToolCalls.length > 0 ? auditToolCalls : undefined,
          latencyMs: Date.now() - startTime,
          model: process.env.ZAI_API_KEY ? getZaiModelFn() : undefined,
          inputTokens: usageRef.current?.inputTokens,
          outputTokens: usageRef.current?.outputTokens,
          error: auditError,
        });
      }
    }, request.signal);

    return new Response(stream, { headers: { ...SSE_HEADERS, ...rateLimit.headers } });
  };
}
