import type {
  composeResponse,
  ToolResultMessage,
} from "@/lib/ai/response-composer";
import type { SSEEvent } from "@/lib/ai/sse";
import type { AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import type { AiLogContext } from "@/lib/ai/logger";
import type OpenAI from "openai";
import { PASS2_MODEL_TIMEOUT_MS } from "@/lib/ai/timeout";
import type { TurnRuntimeState } from "../sse-runtime";
import { runModelStage, type ModelStageOutcome } from "./run-model-stage";

export interface RunPass2Input {
  client: OpenAI;
  systemPrompt: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  toolResults: ToolResultMessage[];

  composeResponseFn: typeof composeResponse;
  stageTimings: AiAuditStageTimings;
  streamSignal: AbortSignal;
  threadId: string;
  requestLogContext: AiLogContext;
  runtimeState: TurnRuntimeState;

  onChunk: (content: string) => void;
  onError: (event: Extract<SSEEvent, { type: "error" }>) => void;
  onUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
  emitTimeoutError: () => void;
}

/**
 * Run pass-2 model invocation. Buffers text via `onChunk`, surfaces composer
 * errors via `onError`. Tool calls are not expected at pass-2 (handler does
 * not register tools on this leg) but if they ever arrived they would be
 * silently ignored (returns "continue") to mirror the prior inline behavior.
 */
export async function runPass2(input: RunPass2Input): Promise<ModelStageOutcome> {
  return runModelStage({
    stage: "pass2_model",
    auditStage: "pass2",
    timeoutMs: PASS2_MODEL_TIMEOUT_MS,
    options: {
      client: input.client,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      toolResults: input.toolResults,
      onUsage: input.onUsage,
    },
    composeResponseFn: input.composeResponseFn,
    stageTimings: input.stageTimings,
    streamSignal: input.streamSignal,
    threadId: input.threadId,
    requestLogContext: input.requestLogContext,
    runtimeState: input.runtimeState,
    emitTimeoutError: input.emitTimeoutError,
    onEvent: (event) => {
      if (event.type === "chunk") {
        input.onChunk(event.content);
        return "continue";
      }
      if (event.type === "error") {
        input.onError(event);
        return "stop";
      }
      return "continue";
    },
  });
}
