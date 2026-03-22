export type CacheStatus =
  | "hit_exact"
  | "hit_semantic"
  | "miss"
  | "bypass"
  | "ineligible"
  | "disabled"
  | "error";

export type SSEEvent =
  | { type: "chunk"; content: string }
  | {
      type: "done";
      threadId: string;
      replayed?: boolean;
      usage?: { inputTokens: number; outputTokens: number };
      cache?: {
        status: CacheStatus;
        entryId?: string;
        bypassReason?: string;
      };
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
      } catch {
        enqueue({ type: "error", message: "Internal error", retryable: false });
      } finally {
        controller.close();
      }
    },
  });
}
