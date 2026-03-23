import test from "node:test";
import assert from "node:assert/strict";
import { consumeSSEStream } from "../src/hooks/useAIStream.ts";

function createMockResponse(sseData: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseData));
      controller.close();
    },
  });
  return new Response(stream);
}

test("consumeSSEStream skips tool_status events without treating them as done", async () => {
  const sseData =
    'data: {"type":"chunk","content":"Looking up"}\n\n' +
    'data: {"type":"tool_status","toolName":"list_members","status":"calling"}\n\n' +
    'data: {"type":"tool_status","toolName":"list_members","status":"done"}\n\n' +
    'data: {"type":"chunk","content":" your members."}\n\n' +
    'data: {"type":"done","threadId":"t-1"}\n\n';

  const chunks: string[] = [];
  const result = await consumeSSEStream(createMockResponse(sseData), {
    onChunk: (content) => chunks.push(content),
  });

  assert.ok(result, "should return a result");
  assert.equal(result!.threadId, "t-1");
  assert.equal(result!.content, "Looking up your members.");
  assert.deepEqual(chunks, ["Looking up", " your members."]);
});

test("consumeSSEStream does not return early on tool_status event", async () => {
  const sseData =
    'data: {"type":"tool_status","toolName":"get_org_stats","status":"calling"}\n\n' +
    'data: {"type":"chunk","content":"Stats ready."}\n\n' +
    'data: {"type":"done","threadId":"t-2"}\n\n';

  const chunks: string[] = [];
  const result = await consumeSSEStream(createMockResponse(sseData), {
    onChunk: (content) => chunks.push(content),
  });

  assert.ok(result);
  assert.equal(result!.content, "Stats ready.");
  assert.equal(result!.threadId, "t-2");
});
