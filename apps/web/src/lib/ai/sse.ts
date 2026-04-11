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
  | { type: "error"; message: string; retryable: boolean }
  | { type: "tool_status"; toolName: string; status: "calling" | "done" | "error" };

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export function encodeSSE(event: SSEEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Create an SSE stream with optional AbortSignal for cancellation.
 * When the client disconnects, the cancel() callback aborts the internal
 * controller, which propagates to the generator via the signal parameter.
 */
export function createSSEStream(
  generator: (enqueue: (event: SSEEvent) => void, signal: AbortSignal) => Promise<void>,
  externalSignal?: AbortSignal
): ReadableStream<Uint8Array> {
  const abortController = new AbortController();

  // Link external signal (e.g. request.signal) to internal abort
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortController.abort();
    } else {
      externalSignal.addEventListener("abort", () => abortController.abort(), { once: true });
    }
  }

  return new ReadableStream({
    async start(streamController) {
      const enqueue = (event: SSEEvent) => {
        if (!abortController.signal.aborted) {
          streamController.enqueue(encodeSSE(event));
        }
      };
      try {
        await generator(enqueue, abortController.signal);
      } catch {
        if (!abortController.signal.aborted) {
          enqueue({ type: "error", message: "Internal error", retryable: false });
        }
      } finally {
        streamController.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });
}
