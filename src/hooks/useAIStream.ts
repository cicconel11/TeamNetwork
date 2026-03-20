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
  messageId: string | null;
  threadId: string | null;
}

interface UseAIStreamReturn extends AIStreamState {
  sendMessage: (message: string, opts: { surface: string; threadId?: string; idempotencyKey: string }) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

export function useAIStream({ orgId }: UseAIStreamOptions): UseAIStreamReturn {
  const [state, setState] = useState<AIStreamState>({
    isStreaming: false,
    error: null,
    currentContent: "",
    messageId: null,
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
      messageId: null,
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
        setState(prev => ({
          ...prev,
          isStreaming: false,
          error: body.error || `HTTP ${response.status}`,
        }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setState(prev => ({ ...prev, isStreaming: false, error: "No response body" }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const event: SSEEvent = JSON.parse(trimmed.slice(6));

            switch (event.type) {
              case "chunk":
                setState(prev => ({
                  ...prev,
                  currentContent: prev.currentContent + event.content,
                }));
                break;
              case "done":
                setState(prev => ({
                  ...prev,
                  isStreaming: false,
                  messageId: event.messageId,
                  threadId: event.threadId,
                }));
                break;
              case "error":
                setState(prev => ({
                  ...prev,
                  isStreaming: false,
                  error: event.message,
                }));
                break;
              // tool_call and tool_result: no UI update needed in v1
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // If we got here without a done/error event, mark as not streaming
      setState(prev => {
        if (prev.isStreaming) return { ...prev, isStreaming: false };
        return prev;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled — no error
        return;
      }
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
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
