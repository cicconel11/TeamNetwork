/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSSEStream, encodeSSE, type SSEEvent } from "../src/lib/ai/sse.ts";

describe("SSE cancellation", () => {
  it("provides AbortSignal to generator", async () => {
    let receivedSignal: AbortSignal | null = null;

    const stream = createSSEStream(async (enqueue, signal) => {
      receivedSignal = signal;
      enqueue({ type: "done", threadId: "t1" });
    });

    // Consume the stream to trigger start()
    const reader = stream.getReader();
    await reader.read();
    await reader.read(); // reads past done
    reader.releaseLock();

    assert.ok(receivedSignal, "Generator should receive an AbortSignal");
    assert.ok(receivedSignal instanceof AbortSignal);
  });

  it("aborts signal when stream is cancelled", async () => {
    let signalAborted = false;

    const stream = createSSEStream(async (enqueue, signal) => {
      signal.addEventListener("abort", () => {
        signalAborted = true;
      });

      // Simulate a long-running generator
      enqueue({ type: "chunk", content: "first chunk" });

      // Wait a tick to allow cancel() to fire
      await new Promise((resolve) => setTimeout(resolve, 50));

      enqueue({ type: "done", threadId: "t1" });
    });

    const reader = stream.getReader();
    await reader.read(); // first chunk
    await reader.cancel(); // client disconnect

    // Give the abort handler time to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(signalAborted, "AbortSignal should be aborted when stream is cancelled");
  });

  it("does not enqueue events after abort", async () => {
    const enqueuedEvents: SSEEvent[] = [];

    const stream = createSSEStream(async (enqueue, signal) => {
      const wrappedEnqueue = (event: SSEEvent) => {
        enqueuedEvents.push(event);
        enqueue(event);
      };

      wrappedEnqueue({ type: "chunk", content: "before cancel" });

      // Wait for cancel to propagate
      await new Promise((resolve) => setTimeout(resolve, 50));

      if (!signal.aborted) {
        wrappedEnqueue({ type: "chunk", content: "after cancel" });
      }

      wrappedEnqueue({ type: "done", threadId: "t1" });
    });

    const reader = stream.getReader();
    await reader.read(); // before cancel
    await reader.cancel();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Only the first chunk should have been enqueued before cancel
    const chunkEvents = enqueuedEvents.filter((e) => e.type === "chunk");
    assert.equal(
      chunkEvents.length,
      1,
      "Should not enqueue chunks after abort"
    );
  });

  it("suppresses error events during abort", async () => {
    // Pre-abort the stream before consumption
    const externalAbort = new AbortController();
    externalAbort.abort();

    const abortedStream = createSSEStream(
      async () => {
        throw new Error("should be suppressed");
      },
      externalAbort.signal
    );

    const reader = abortedStream.getReader();
    const result = await reader.read();

    // Stream should close without error event when already aborted
    assert.ok(
      result.done || !result.value?.toString().includes('"error"'),
      "Error events should be suppressed when signal is already aborted"
    );
  });

  it("links external signal to internal abort", async () => {
    const externalAbort = new AbortController();
    let internalAborted = false;

    const stream = createSSEStream(async (_enqueue, signal) => {
      signal.addEventListener("abort", () => {
        internalAborted = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
    }, externalAbort.signal);

    const reader = stream.getReader();
    reader.read(); // Start consuming

    // Abort via external signal
    externalAbort.abort();

    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.ok(
      internalAborted,
      "External signal abort should propagate to internal signal"
    );
  });

  it("handles already-aborted external signal", async () => {
    const externalAbort = new AbortController();
    externalAbort.abort(); // Pre-abort

    let generatorRan = false;

    const stream = createSSEStream(async (enqueue, signal) => {
      generatorRan = true;
      assert.ok(
        signal.aborted,
        "Signal should be aborted from the start"
      );
    }, externalAbort.signal);

    const reader = stream.getReader();
    await reader.read();

    assert.ok(generatorRan, "Generator should still run even with pre-aborted signal");
  });
});

describe("SSE encodeSSE", () => {
  it("formats events as SSE data lines", () => {
    const event: SSEEvent = { type: "chunk", content: "hello" };
    const encoded = new TextDecoder().decode(encodeSSE(event));

    assert.equal(encoded, `data: ${JSON.stringify(event)}\n\n`);
  });

  it("handles done events with all fields", () => {
    const event: SSEEvent = {
      type: "done",
      threadId: "t1",
      replayed: true,
      usage: { inputTokens: 100, outputTokens: 50 },
      cache: { status: "hit_exact", entryId: "c1" },
    };
    const encoded = new TextDecoder().decode(encodeSSE(event));

    assert.ok(encoded.startsWith("data: "));
    assert.ok(encoded.includes('"replayed":true'));
    assert.ok(encoded.endsWith("\n\n"));
  });
});
