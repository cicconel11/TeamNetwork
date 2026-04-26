import type {
  composeResponse,
  ToolCallRequestedEvent,
} from "@/lib/ai/response-composer";
import type { SSEEvent } from "@/lib/ai/sse";
import type { AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import type { AiLogContext } from "@/lib/ai/logger";
import type OpenAI from "openai";
import { PASS1_MODEL_TIMEOUT_MS } from "@/lib/ai/timeout";
import type { TurnRuntimeState } from "../sse-runtime";
import { runModelStage, type ModelStageOutcome } from "./run-model-stage";

export interface RunPass1Input {
  client: OpenAI;
  systemPrompt: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.ChatCompletionTool[] | undefined;
  toolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption | undefined;

  composeResponseFn: typeof composeResponse;
  stageTimings: AiAuditStageTimings;
  streamSignal: AbortSignal;
  threadId: string;
  requestLogContext: AiLogContext;
  runtimeState: TurnRuntimeState;

  /** Push pass-1 text chunks here; pass2 grounding decides when to flush. */
  onChunk: (content: string) => void;
  /** Forward composer error events (audit + SSE enqueue handled by orchestrator). */
  onError: (event: Extract<SSEEvent, { type: "error" }>) => void;
  /** Handle a single tool_call_requested event. Return "stop" to abort pass1. */
  onToolCall: (
    event: ToolCallRequestedEvent,
  ) => Promise<"continue" | "stop"> | "continue" | "stop";
  onUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
  emitTimeoutError: () => void;
}

/**
 * Run pass-1 model invocation. Buffers text via `onChunk`, surfaces composer
 * errors via `onError`, and delegates tool_call_requested events to
 * `onToolCall`. Returns the underlying ModelStageOutcome so callers can
 * decide whether to short-circuit the turn.
 */
export async function runPass1(
  input: RunPass1Input,
): Promise<ModelStageOutcome> {
  return runModelStage({
    stage: "pass1_model",
    auditStage: "pass1_model",
    timeoutMs: PASS1_MODEL_TIMEOUT_MS,
    options: {
      client: input.client,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      tools: input.tools,
      toolChoice: input.toolChoice,
      onUsage: input.onUsage,
    },
    composeResponseFn: input.composeResponseFn,
    stageTimings: input.stageTimings,
    streamSignal: input.streamSignal,
    threadId: input.threadId,
    requestLogContext: input.requestLogContext,
    runtimeState: input.runtimeState,
    emitTimeoutError: input.emitTimeoutError,
    onEvent: async (event) => {
      if (event.type === "chunk") {
        input.onChunk(event.content);
        return "continue";
      }
      if (event.type === "error") {
        input.onError(event);
        return "stop";
      }
      return await input.onToolCall(event as ToolCallRequestedEvent);
    },
  });
}
