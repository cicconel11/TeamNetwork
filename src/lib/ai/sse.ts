export type SSEEvent =
  | { type: "chunk"; content: string }
  | {
      type: "done";
      threadId: string;
      replayed?: boolean;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; message: string; retryable: boolean };

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export function encodeSSE(event: SSEEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function createSSEStream(
  generator: (enqueue: (event: SSEEvent) => void) => Promise<void>
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const enqueue = (event: SSEEvent) => controller.enqueue(encodeSSE(event));
      try {
        await generator(enqueue);
      } catch (err) {
        enqueue({ type: "error", message: "Internal error", retryable: false });
      } finally {
        controller.close();
      }
    },
  });
}
