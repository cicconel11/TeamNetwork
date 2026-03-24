import test from "node:test";
import assert from "node:assert/strict";
import { composeResponse } from "../../../src/lib/ai/response-composer.ts";
import type OpenAI from "openai";
import type { ToolCallRequestedEvent } from "../../../src/lib/ai/response-composer.ts";
import type { SSEEvent } from "../../../src/lib/ai/sse.ts";

function createMockClient(chunks: Array<Record<string, unknown>>) {
  return {
    chat: {
      completions: {
        create: async () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) {
              yield chunk as OpenAI.Chat.ChatCompletionChunk;
            }
          },
        }),
      },
    },
  } as unknown as OpenAI;
}

test("composeResponse yields ToolCallRequestedEvent when LLM returns tool_calls", async () => {
  const client = createMockClient([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "list_members", arguments: '{"lim' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'it": 5}' } }] } }] },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]);

  const events: Array<SSEEvent | ToolCallRequestedEvent> = [];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [{ role: "user", content: "list members" }],
    tools: [{ type: "function", function: { name: "list_members", parameters: {} } }] as OpenAI.Chat.ChatCompletionTool[],
  })) {
    events.push(event);
  }

  const toolEvent = events.find((e) => e.type === "tool_call_requested") as ToolCallRequestedEvent;
  assert.ok(toolEvent, "should have a tool_call_requested event");
  assert.equal(toolEvent.id, "call-1");
  assert.equal(toolEvent.name, "list_members");
  assert.equal(toolEvent.argsJson, '{"limit": 5}');
});

test("composeResponse yields normal chunks when no tools param", async () => {
  const client = createMockClient([
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " world" }, finish_reason: "stop" }] },
  ]);

  const events: Array<SSEEvent | ToolCallRequestedEvent> = [];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [{ role: "user", content: "hi" }],
  })) {
    events.push(event);
  }

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "chunk");
  assert.equal(events[1].type, "chunk");
});

test("composeResponse passes tools and tool_choice to API call", async () => {
  let capturedParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming | undefined;
  let capturedOptions: OpenAI.RequestOptions | undefined;
  const client = {
    chat: {
      completions: {
        create: async (
          params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          options?: OpenAI.RequestOptions
        ) => {
          capturedParams = params;
          capturedOptions = options;
          return { [Symbol.asyncIterator]: async function* () {} };
        },
      },
    },
  } as unknown as OpenAI;

  const tools = [{ type: "function" as const, function: { name: "test", parameters: {} } }];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [],
    tools: tools as OpenAI.Chat.ChatCompletionTool[],
    signal: new AbortController().signal,
  })) {
    void event;
  }

  assert.deepEqual(capturedParams.tools, tools);
  assert.equal(capturedParams.tool_choice, "auto");
  assert.ok(capturedOptions?.signal instanceof AbortSignal);
});

test("composeResponse does NOT pass tools/tool_choice when tools is undefined", async () => {
  let capturedParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming | undefined;
  const client = {
    chat: {
      completions: {
        create: async (params: OpenAI.Chat.ChatCompletionCreateParamsStreaming) => {
          capturedParams = params;
          return { [Symbol.asyncIterator]: async function* () {} };
        },
      },
    },
  } as unknown as OpenAI;

  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [],
  })) {
    void event;
  }

  assert.equal(capturedParams.tools, undefined);
  assert.equal(capturedParams.tool_choice, undefined);
});

test("composeResponse can yield both text chunks and tool call", async () => {
  const client = createMockClient([
    { choices: [{ delta: { content: "Let me check" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-2", function: { name: "get_org_stats", arguments: "{}" } }] } }] },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]);

  const events: Array<SSEEvent | ToolCallRequestedEvent> = [];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [],
    tools: [] as OpenAI.Chat.ChatCompletionTool[],
  })) {
    events.push(event);
  }

  const chunkEvents = events.filter((e) => e.type === "chunk");
  const toolEvents = events.filter((e) => e.type === "tool_call_requested");
  assert.equal(chunkEvents.length, 1);
  assert.equal(chunkEvents[0].content, "Let me check");
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].id, "call-2");
  assert.equal(toolEvents[0].name, "get_org_stats");
});

test("composeResponse yields every streamed tool call in index order", async () => {
  const client = createMockClient([
    {
      choices: [{
        delta: {
          tool_calls: [
            { index: 1, id: "call-2", function: { name: "list_events", arguments: `{"up` } },
            { index: 0, id: "call-1", function: { name: "list_members", arguments: `{"limit":` } },
          ],
        },
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: " 5}" } },
            { index: 1, function: { arguments: `coming": true}` } },
          ],
        },
      }],
    },
    { choices: [{ finish_reason: "tool_calls", delta: {} }] },
  ]);

  const events: ToolCallRequestedEvent[] = [];
  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [],
    tools: [] as OpenAI.Chat.ChatCompletionTool[],
  })) {
    if (event.type === "tool_call_requested") {
      events.push(event);
    }
  }

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => ({ id: event.id, name: event.name, argsJson: event.argsJson })),
    [
      { id: "call-1", name: "list_members", argsJson: '{"limit": 5}' },
      { id: "call-2", name: "list_events", argsJson: '{"upcoming": true}' },
    ]
  );
});

test("composeResponse replays tool results as assistant and tool messages", async () => {
  let capturedParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming | undefined;
  const client = {
    chat: {
      completions: {
        create: async (params: OpenAI.Chat.ChatCompletionCreateParamsStreaming) => {
          capturedParams = params;
          return { [Symbol.asyncIterator]: async function* () {} };
        },
      },
    },
  } as unknown as OpenAI;

  for await (const event of composeResponse({
    client,
    systemPrompt: "test",
    messages: [{ role: "user", content: "Who is in the org?" }],
    toolResults: [
      {
        toolCallId: "call-1",
        name: "list_members",
        args: { limit: 5 },
        data: [{ id: "m1", name: "Alice" }],
      },
    ],
  })) {
    void event;
  }

  const messages = capturedParams?.messages ?? [];
  const assistantToolMessage =
    messages[2] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
  const toolMessage = messages[3] as OpenAI.Chat.ChatCompletionToolMessageParam;

  assert.equal(assistantToolMessage.role, "assistant");
  assert.equal(assistantToolMessage.tool_calls[0].id, "call-1");
  assert.equal(assistantToolMessage.tool_calls[0].function.name, "list_members");
  assert.equal(toolMessage.role, "tool");
  assert.equal(toolMessage.tool_call_id, "call-1");
  assert.equal(toolMessage.content, JSON.stringify([{ id: "m1", name: "Alice" }]));
});

test("composeResponse rethrows aborts instead of yielding error events", async () => {
  const abortController = new AbortController();
  abortController.abort(new Error("aborted"));

  const client = {
    chat: {
      completions: {
        create: async () => {
          throw new Error("ignored because signal is already aborted");
        },
      },
    },
  } as unknown as OpenAI;

  await assert.rejects(
    async () => {
      for await (const event of composeResponse({
        client,
        systemPrompt: "test",
        messages: [],
        signal: abortController.signal,
      })) {
        void event;
      }
    },
    /aborted/
  );
});
