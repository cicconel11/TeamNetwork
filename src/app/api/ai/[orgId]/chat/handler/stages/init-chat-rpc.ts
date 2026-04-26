/**
 * Stage 5: init_ai_chat RPC + assistant-message inserter factory.
 *
 * Wraps the `runTimedStage("init_chat_rpc")` block. Calls the
 * `init_ai_chat` Postgres RPC which atomically creates/reuses a thread and
 * inserts the user message. On success returns the resolved `threadId` plus
 * a closure (`insertAssistantMessage`) that the orchestrator passes to every
 * downstream branch that needs to write an assistant row.
 *
 * Returns a `StageOutcome` so the orchestrator short-circuits on RPC error.
 */
import { NextResponse } from "next/server";
import { runTimedStage, type AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import type { AiOrgContext } from "@/lib/ai/context";
import type { CacheSurface } from "@/lib/ai/semantic-cache-utils";
import type { sendMessageSchema } from "@/lib/schemas";
import type { StageOutcome } from "./state";

type ValidatedBody = ReturnType<typeof sendMessageSchema.parse>;

export interface AssistantInserter {
  (input: { content: string | null; status: "pending" | "complete" }): Promise<{
    data: { id: string } | null;
    error: unknown;
  }>;
}

export interface InitChatRpcInput {
  ctx: Extract<AiOrgContext, { ok: true }>;
  rateLimit: { headers: Record<string, string> | undefined };
  stageTimings: AiAuditStageTimings;
  requestLogContext: AiLogContext;
  surface: ValidatedBody["surface"];
  message: string;
  idempotencyKey: string;
  threadId: string | undefined;
  resolvedIntent: string;
  resolvedIntentType: string;
  effectiveSurface: CacheSurface;
}

export interface InitChatRpcSlice {
  threadId: string;
  insertAssistantMessage: AssistantInserter;
}

export async function runInitChatRpcStage(
  input: InitChatRpcInput,
): Promise<StageOutcome<InitChatRpcSlice>> {
  const { data: initResult, error: initError } = await runTimedStage(
    input.stageTimings,
    "init_chat_rpc",
    async () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (input.ctx.serviceSupabase as any).rpc("init_ai_chat", {
        p_user_id: input.ctx.userId,
        p_org_id: input.ctx.orgId,
        p_surface: input.surface,
        p_title: input.message.slice(0, 100),
        p_message: input.message,
        p_idempotency_key: input.idempotencyKey,
        p_thread_id: input.threadId ?? null,
        p_intent: input.resolvedIntent,
        p_context_surface: input.effectiveSurface,
        p_intent_type: input.resolvedIntentType,
      }),
  );

  if (initError || !initResult) {
    aiLog("error", "ai-chat", "init_ai_chat RPC failed", input.requestLogContext, {
      error: initError,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to initialize chat" },
        { status: 500, headers: input.rateLimit.headers },
      ),
    };
  }

  const threadId: string = initResult.thread_id;

  const insertAssistantMessage: AssistantInserter = async (insertInput) =>
    input.ctx.supabase
      .from("ai_messages")
      .insert({
        thread_id: threadId,
        org_id: input.ctx.orgId,
        user_id: input.ctx.userId,
        role: "assistant",
        intent: input.resolvedIntent,
        intent_type: input.resolvedIntentType,
        context_surface: input.effectiveSurface,
        status: insertInput.status,
        content: insertInput.content,
      })
      .select("id")
      .single();

  return { ok: true, value: { threadId, insertAssistantMessage } };
}
