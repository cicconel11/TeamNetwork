import type OpenAI from "openai";
import { getZaiModel } from "./client";
import type { SSEEvent } from "./sse";
import { aiLog, type AiLogContext } from "./logger";

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
}

/**
 * Streams a composed response from z.ai as SSE chunk/error events.
 * The route owns completion semantics and emits the final done event.
 *
 * When `tools` is provided, the LLM may choose to call a tool instead of
 * generating text. In that case, a ToolCallRequestedEvent is yielded.
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
  } = options;

  // Build message array
  const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  // If tool results exist, replay them as tool messages to preserve the trust boundary.
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

  try {
    const stream = await client.chat.completions.create(
      {
        model: getZaiModel(),
        messages: apiMessages,
        ...(tools ? { tools, tool_choice: toolChoice ?? ("auto" as const) } : {}),
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.7,
        max_tokens: 2000,
      },
      signal ? { signal } : undefined
    );

    const toolCalls = new Map<number, { id: string; name: string; argsJson: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield { type: "chunk", content: delta.content };
      }

      for (const tc of delta?.tool_calls ?? []) {
        const existing = toolCalls.get(tc.index) ?? {
          id: tc.id ?? `tool-call-${tc.index}`,
          name: "",
          argsJson: "",
        };

        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.argsJson += tc.function.arguments;

        toolCalls.set(tc.index, existing);
      }

      if (chunk.choices[0]?.finish_reason === "tool_calls") {
        for (const toolCall of [...toolCalls.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, value]) => value)
          .filter((value) => value.name)) {
          yield {
            type: "tool_call_requested",
            id: toolCall.id,
            name: toolCall.name,
            argsJson: toolCall.argsJson,
          };
        }
      }

      // Usage arrives on the final chunk (when stream_options.include_usage is true).
      // Gracefully skip if the provider doesn't support it.
      if (chunk.usage && onUsage) {
        onUsage({
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        });
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
