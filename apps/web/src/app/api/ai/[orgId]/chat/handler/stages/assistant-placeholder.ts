/**
 * Stage: write the pending assistant message placeholder.
 *
 * Wraps the `runTimedStage("assistant_placeholder_write")` block that
 * follows RAG retrieval. On insert failure returns a 500 response so the
 * orchestrator can short-circuit; on success returns the message id used
 * downstream by streaming + grounding + audit.
 */
import { NextResponse } from "next/server";
import {
  runTimedStage,
  type AiAuditStageTimings,
} from "@/lib/ai/chat-telemetry";
import { aiLog, type AiLogContext } from "@/lib/ai/logger";
import type { StageOutcome } from "./state";
import type { AssistantInserter } from "./init-chat-rpc";

export interface AssistantPlaceholderInput {
  threadId: string;
  rateLimit: { headers: Record<string, string> | undefined };
  stageTimings: AiAuditStageTimings;
  requestLogContext: AiLogContext;
  insertAssistantMessage: AssistantInserter;
}

export async function runAssistantPlaceholderStage(
  input: AssistantPlaceholderInput,
): Promise<StageOutcome<{ assistantMessageId: string }>> {
  const { data: assistantMsg, error: assistantError } = await runTimedStage(
    input.stageTimings,
    "assistant_placeholder_write",
    async () =>
      input.insertAssistantMessage({ content: null, status: "pending" }),
  );

  if (assistantError || !assistantMsg) {
    aiLog(
      "error",
      "ai-chat",
      "assistant placeholder failed",
      { ...input.requestLogContext, threadId: input.threadId },
      { error: assistantError },
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to create response" },
        { status: 500, headers: input.rateLimit.headers },
      ),
    };
  }

  return { ok: true, value: { assistantMessageId: assistantMsg.id } };
}
