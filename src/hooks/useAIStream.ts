"use client";

import { useState, useCallback, useRef } from "react";
import type { SSEEvent } from "@/lib/ai/sse";

interface UseAIStreamOptions {
  orgId: string;
}

interface AIStreamState {
  isStreaming: boolean;
  error: string | null;
  currentContent: string;
  threadId: string | null;
}

export interface AIStreamResult {
  threadId: string;
  content?: string;
  replayed?: boolean;
  inFlight?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

interface UseAIStreamReturn extends AIStreamState {
  sendMessage: (
    message: string,
    opts: { surface: string; threadId?: string; idempotencyKey: string }
  ) => Promise<AIStreamResult | null>;
  cancel: () => void;
  clearError: () => void;
}

interface StreamCallbacks {
  onChunk?: (content: string) => void;
  onDone?: (event: Extract<SSEEvent, { type: "done" }>) => void;
  onError?: (message: string) => void;
}

interface AIErrorBody {
  error?: string;
  threadId?: string;
}

export function parseAIChatFailure(
  status: number,
  body: AIErrorBody
): { result: AIStreamResult | null; error: string | null } {
  if (status === 409 && body.threadId) {
    return {
      result: {
        threadId: body.threadId,
        inFlight: true,
      },
      error: null,
    };
  }

  return {
    result: null,
    error: body.error || `HTTP ${status}`,
  };
}

export async function consumeSSEStream(
  response: Response,
  callbacks: StreamCallbacks
): Promise<AIStreamResult | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const event: SSEEvent = JSON.parse(trimmed.slice(6));

        if (event.type === "chunk") {
          fullContent += event.content;
          callbacks.onChunk?.(event.content);
          continue;
        }

        if (event.type === "error") {
          callbacks.onError?.(event.message);
          return null;
        }

        if (event.type === "done") {
          callbacks.onDone?.(event);
          return {
            threadId: event.threadId,
            content: fullContent,
            replayed: event.replayed,
            usage: event.usage,
          };
        }
        // Skip unrecognized event types (e.g., tool_status)
      } catch {
        // Ignore malformed events and keep streaming.
      }
    }
  }

  return null;
}

export function useAIStream({ orgId }: UseAIStreamOptions): UseAIStreamReturn {
  const [state, setState] = useState<AIStreamState>({
    isStreaming: false,
    error: null,
    currentContent: "",
    threadId: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const sendMessage = useCallback(async (
    message: string,
    opts: { surface: string; threadId?: string; idempotencyKey: string }
  ) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      isStreaming: true,
      error: null,
      currentContent: "",
      threadId: opts.threadId ?? null,
    });

    try {
      const response = await fetch(`/api/ai/${orgId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          surface: opts.surface,
          threadId: opts.threadId,
          idempotencyKey: opts.idempotencyKey,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Request failed" }));
        const failure = parseAIChatFailure(response.status, body);
        setState(prev => ({
          ...prev,
          isStreaming: false,
          threadId: failure.result?.threadId ?? prev.threadId,
          error: failure.error,
        }));
        return failure.result;
      }

      const result = await consumeSSEStream(response, {
        onChunk: (content) => {
          setState((prev) => ({
            ...prev,
            currentContent: prev.currentContent + content,
          }));
        },
        onDone: (event) => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            threadId: event.threadId,
          }));
        },
        onError: (messageText) => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: messageText,
          }));
        },
      });

      setState(prev => {
        if (prev.isStreaming) return { ...prev, isStreaming: false };
        return prev;
      });

      return result;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled — no error
        return null;
      }
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
      return null;
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [orgId]);

  return {
    ...state,
    sendMessage,
    cancel,
    clearError,
  };
}
