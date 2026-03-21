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
import { createSSEStream, SSE_HEADERS } from "@/lib/ai/sse";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const startTime = Date.now();

  // 1. Rate limit — get user first to allow per-user limiting
  const supabase = await createClient();
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
  const ctx = await getAiOrgContext(orgId, user, rateLimit, { supabase });
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

  // 4. Validate provided thread ownership before any cleanup or writes
  let threadId = existingThreadId;
  if (threadId) {
    const resolution = await resolveOwnThread(
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
    await ctx.supabase
      .from("ai_messages")
      .update({ status: "error", content: "[abandoned]" })
      .eq("thread_id", existingThreadId)
      .eq("role", "assistant")
      .in("status", ["pending", "streaming"])
      .lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  }

  // 6. Idempotency check — look up by idempotency_key
  const { data: existingMsg } = await ctx.supabase
    .from("ai_messages")
    .select("id, status, thread_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingMsg) {
    if (existingMsg.status === "complete") {
      return new Response(
        createSSEStream(async (enqueue) => {
          enqueue({
            type: "done",
            threadId: existingMsg.thread_id,
            replayed: true,
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

  // 7. Upsert thread
  if (!threadId) {
    const { data: newThread, error: threadError } = await ctx.supabase
      .from("ai_threads")
      .insert({
        user_id: ctx.userId,
        org_id: ctx.orgId,
        surface,
        title: message.slice(0, 100),
      })
      .select("id")
      .single();

    if (threadError || !newThread) {
      console.error("[ai-chat] thread creation failed:", threadError);
      return NextResponse.json(
        { error: "Failed to create thread" },
        { status: 500, headers: rateLimit.headers }
      );
    }
    threadId = newThread.id;
  }

  // 8. Insert user message
  const { error: userMsgError } = await ctx.supabase.from("ai_messages").insert({
    thread_id: threadId,
    org_id: ctx.orgId,
    user_id: ctx.userId,
    role: "user",
    content: message,
    status: "complete",
    idempotency_key: idempotencyKey,
  });

  if (userMsgError) {
    console.error("[ai-chat] user message insert failed:", userMsgError);
    return NextResponse.json(
      { error: "Failed to save message" },
      { status: 500, headers: rateLimit.headers }
    );
  }

  // 9. Insert assistant placeholder
  const { data: assistantMsg, error: assistantError } = await ctx.supabase
    .from("ai_messages")
    .insert({
      thread_id: threadId,
      org_id: ctx.orgId,
      user_id: ctx.userId,
      role: "assistant",
      status: "pending",
      content: null,
    })
    .select("id")
    .single();

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

    try {
      // Guard: ZAI_API_KEY required
      if (!process.env.ZAI_API_KEY) {
        const msg =
          "AI assistant is not configured. Please set the ZAI_API_KEY environment variable.";
        enqueue({ type: "chunk", content: msg });
        fullContent = msg;
        enqueue({ type: "done", threadId: threadId! });
        return;
      }

      const client = createZaiClient();

      // Mark assistant message as streaming
      await ctx.supabase
        .from("ai_messages")
        .update({ intent: "general", status: "streaming" })
        .eq("id", assistantMessageId);

      // Build context and fetch history in parallel
      const [{ systemPrompt, orgContextMessage }, { data: history }] = await Promise.all([
        buildPromptContext({
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: ctx.role,
          serviceSupabase: ctx.serviceSupabase,
        }),
        ctx.supabase
          .from("ai_messages")
          .select("role, content")
          .eq("thread_id", threadId)
          .eq("status", "complete")
          .order("created_at", { ascending: true })
          .limit(20),
      ]);

      const historyMessages = (history ?? [])
        .filter((m: any) => m.content)
        .map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content as string,
        }));

      const contextMessages = orgContextMessage
        ? [{ role: "user" as const, content: orgContextMessage }, ...historyMessages]
        : historyMessages;

      for await (const event of composeResponse({
        client,
        systemPrompt,
        messages: contextMessages,
        onUsage: (u) => { usageRef.current = u; },
      })) {
        if (event.type === "chunk") {
          fullContent += event.content;
          enqueue(event);
        } else if (event.type === "error") {
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
      });
    } catch (err) {
      console.error("[ai-chat] stream error:", err);
      enqueue({ type: "error", message: "An error occurred", retryable: true });
    } finally {
      // Update assistant message row to final state
      await ctx.supabase
        .from("ai_messages")
        .update({
          content: fullContent || "[error]",
          status: fullContent ? "complete" : "error",
        })
        .eq("id", assistantMessageId);

      // Audit log — fire-and-forget (never awaited)
      logAiRequest(ctx.serviceSupabase, {
        threadId: threadId!,
        messageId: assistantMessageId,
        userId: ctx.userId,
        orgId: ctx.orgId,
        intent: "general",
        latencyMs: Date.now() - startTime,
        model: process.env.ZAI_API_KEY ? getZaiModel() : undefined,
        inputTokens: usageRef.current?.inputTokens,
        outputTokens: usageRef.current?.outputTokens,
      });
    }
  });

  return new Response(stream, { headers: { ...SSE_HEADERS, ...rateLimit.headers } });
}
