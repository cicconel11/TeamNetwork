import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { consumeSSEStream } from "../src/hooks/useAIStream.ts";

describe("consumeSSEStream", () => {
  it("returns the final done payload and streams chunks in order", async () => {
    const seenChunks: string[] = [];
    let doneThreadId = "";

    const response = new Response(
      [
        'data: {"type":"chunk","content":"Hello"}\n\n',
        'data: {"type":"chunk","content":" world"}\n\n',
        'data: {"type":"done","threadId":"thread-123","replayed":true}\n\n',
      ].join(""),
      { headers: { "Content-Type": "text/event-stream" } }
    );

    const result = await consumeSSEStream(response, {
      onChunk: (content) => seenChunks.push(content),
      onDone: (event) => {
        doneThreadId = event.threadId;
      },
    });

    assert.deepEqual(seenChunks, ["Hello", " world"]);
    assert.equal(doneThreadId, "thread-123");
    assert.deepEqual(result, { threadId: "thread-123", replayed: true, usage: undefined });
  });

  it("returns null on SSE error events", async () => {
    let seenError = "";
    const response = new Response(
      'data: {"type":"error","message":"boom","retryable":false}\n\n',
      { headers: { "Content-Type": "text/event-stream" } }
    );

    const result = await consumeSSEStream(response, {
      onError: (message) => {
        seenError = message;
      },
    });

    assert.equal(seenError, "boom");
    assert.equal(result, null);
  });
});
