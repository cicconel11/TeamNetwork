import type OpenAI from "openai";
import { getZaiModel } from "./client";
import type { SSEEvent } from "./sse";
import { aiLog, type AiLogContext } from "./logger";
import {
  runLlmStream,
  type LlmProfile,
  type LlmStreamEvent,
  type LlmTrackOpsEventFn,
} from "./llm";

export interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCallRequestedEvent {
  type: "tool_call_requested";
  id: string;
  name: string;
  argsJson: string;
}

export interface ToolResultMessage {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  data: unknown;
}

interface ComposeOptions {
  client: OpenAI;
  systemPrompt: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  toolResults?: ToolResultMessage[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
  onUsage?: (usage: UsageAccumulator) => void;
  signal?: AbortSignal;
  logContext?: AiLogContext;
  /** Sampling temperature. Defaults to 0.7. Set to 0 for deterministic tool routing. */
  temperature?: number;
  /** Max output tokens. Defaults to 2000. */
  maxTokens?: number;
  /** Override model. Defaults to getZaiModel(). */
  model?: string;
  /**
   * Optional LLM profile. When supplied, retry/fallback/timeout/ops behavior
   * defined by the profile is honored at the streaming boundary (pre-stream
   * errors only — mid-stream errors are non-retryable by design).
   */
  profile?: LlmProfile;
  /** Ops-event sink for retry/giveup/midstream classification. */
  trackOpsEvent?: LlmTrackOpsEventFn;
  /** Org context for ops events. */
  orgId?: string;
}

/**
 * Streams a composed response from z.ai as SSE chunk/error events.
 * The route owns completion semantics and emits the final done event.
 *
 * When `tools` is provided, the LLM may choose to call a tool instead of
 * generating text. In that case, a ToolCallRequestedEvent is yielded.
 *
 * Retry/fallback live in `runLlmStream`. This generator translates the
 * wrapper's stream events into SSE-compatible chunks + the composer's tool-
 * call protocol, and surfaces user-facing error events for terminal failures.
 */
export async function* composeResponse(
  options: ComposeOptions
): AsyncGenerator<SSEEvent | ToolCallRequestedEvent> {
  const {
    client,
    systemPrompt,
    messages,
    toolResults,
    tools,
    toolChoice,
    onUsage,
    signal,
    logContext,
    temperature = 0.7,
    maxTokens = 2000,
    model,
    profile,
    trackOpsEvent,
    orgId,
  } = options;

  const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  if (toolResults && toolResults.length > 0) {
    apiMessages.push({
      role: "assistant",
      content: "",
      tool_calls: toolResults.map((toolResult) => ({
        id: toolResult.toolCallId,
        type: "function" as const,
        function: {
          name: toolResult.name,
          arguments: JSON.stringify(toolResult.args),
        },
      })),
    });

    for (const toolResult of toolResults) {
      apiMessages.push({
        role: "tool",
        tool_call_id: toolResult.toolCallId,
        content: JSON.stringify(toolResult.data),
      });
    }
  }

  const effectiveProfile: LlmProfile = profile ?? {
    name: "compose_default",
    model: model ?? getZaiModel(),
    temperature,
    maxTokens,
    timeoutMs: 30_000,
    maxRetries: 0,
  };

  const toolCalls = new Map<number, { id: string; name: string; argsJson: string }>();

  try {
    const streamIter = runLlmStream(effectiveProfile, {
      messages: apiMessages,
      tools,
      toolChoice,
      signal,
      overrides: {
        temperature,
        maxTokens,
        ...(model ? { model } : {}),
      },
      client,
      trackOpsEvent,
      orgId,
    });

    for await (const event of streamIter) {
      const result = handleStreamEvent(event, toolCalls, onUsage);
      if (result) {
        if (Array.isArray(result)) {
          for (const yielded of result) yield yielded;
        } else {
          yield result;
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      throw signal.reason ?? err;
    }
    aiLog("error", "response-composer", "streaming failed", logContext ?? {
      requestId: "unknown_request",
      orgId: "unknown_org",
    }, { error: err });
    yield {
      type: "error",
      message: "Failed to generate response",
      retryable: true,
    };
  }
}

function handleStreamEvent(
  event: LlmStreamEvent,
  toolCalls: Map<number, { id: string; name: string; argsJson: string }>,
  onUsage: ((usage: UsageAccumulator) => void) | undefined,
): SSEEvent | ToolCallRequestedEvent | Array<SSEEvent | ToolCallRequestedEvent> | null {
  if (event.type === "chunk") {
    return { type: "chunk", content: event.content };
  }

  if (event.type === "tool_call_delta") {
    const existing = toolCalls.get(event.index) ?? {
      id: event.id ?? `tool-call-${event.index}`,
      name: "",
      argsJson: "",
    };
    if (event.id) existing.id = event.id;
    if (event.name) existing.name = event.name;
    if (event.argumentsFragment) existing.argsJson += event.argumentsFragment;
    toolCalls.set(event.index, existing);
    return null;
  }

  if (event.type === "finish" && event.reason === "tool_calls") {
    return [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value)
      .filter((value) => value.name)
      .map(
        (toolCall): ToolCallRequestedEvent => ({
          type: "tool_call_requested",
          id: toolCall.id,
          name: toolCall.name,
          argsJson: toolCall.argsJson,
        }),
      );
  }

  if (event.type === "usage") {
    onUsage?.({ inputTokens: event.inputTokens, outputTokens: event.outputTokens });
    return null;
  }

  if (event.type === "stream_error") {
    if (event.httpStatus === 429) {
      return {
        type: "error",
        message: "The AI provider is rate limited right now. Please try again shortly.",
        retryable: true,
      };
    }
    return {
      type: "error",
      message: "Failed to generate response",
      retryable: true,
    };
  }

  return null;
}
