"use client";

import { useState, useCallback, useRef } from "react";
import type { SSEEvent } from "@/lib/ai/sse";
import { deriveToolStatusLabel } from "@/components/ai-assistant/tool-status";
import type { PendingActionState } from "@/components/ai-assistant/panel-state";

interface UseAIStreamOptions {
  orgId: string;
}

export interface AIChatAttachment {
  storagePath: string;
  fileName: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/jpg";
}

interface AIStreamState {
  isStreaming: boolean;
  error: string | null;
  currentContent: string;
  threadId: string | null;
  toolStatusLabel: string | null;
  pendingActions: PendingActionState[];
}

export interface AIStreamResult {
  threadId: string;
  content?: string;
  replayed?: boolean;
  inFlight?: boolean;
  interrupted?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

interface UseAIStreamReturn extends AIStreamState {
  sendMessage: (
    message: string,
    opts: {
      surface: string;
      currentPath?: string;
      threadId?: string;
      idempotencyKey: string;
      attachment?: AIChatAttachment;
    }
  ) => Promise<AIStreamResult | null>;
  cancel: () => void;
  clearError: () => void;
}

interface StreamCallbacks {
  onChunk?: (content: string) => void;
  onDone?: (event: Extract<SSEEvent, { type: "done" }>) => void;
  onError?: (message: string) => void;
  onToolStatus?: (event: Extract<SSEEvent, { type: "tool_status" }>) => void;
  onPendingAction?: (event: Extract<SSEEvent, { type: "pending_action" }>) => void;
  onPendingActionsBatch?: (event: Extract<SSEEvent, { type: "pending_actions_batch" }>) => void;
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

        if (event.type === "tool_status") {
          callbacks.onToolStatus?.(event);
          continue;
        }

        if (event.type === "pending_action") {
          callbacks.onPendingAction?.(event);
          continue;
        }

        if (event.type === "pending_actions_batch") {
          callbacks.onPendingActionsBatch?.(event);
        }
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
    toolStatusLabel: null,
    pendingActions: [],
  });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(prev => ({ ...prev, isStreaming: false, toolStatusLabel: null }));
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const sendMessage = useCallback(async (
    message: string,
    opts: {
      surface: string;
      currentPath?: string;
      threadId?: string;
      idempotencyKey: string;
      attachment?: AIChatAttachment;
    }
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
      toolStatusLabel: null,
      pendingActions: [],
    });
    let responseThreadId = opts.threadId ?? null;

    try {
      const response = await fetch(`/api/ai/${orgId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          surface: opts.surface,
          currentPath: opts.currentPath,
          threadId: opts.threadId,
          idempotencyKey: opts.idempotencyKey,
          attachment: opts.attachment,
        }),
        signal: controller.signal,
      });
      responseThreadId = response.headers.get("x-ai-thread-id") ?? responseThreadId;
      if (responseThreadId) {
        setState(prev => ({ ...prev, threadId: responseThreadId }));
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Request failed" }));
        const failure = parseAIChatFailure(response.status, body);
        setState(prev => ({
          ...prev,
          isStreaming: false,
          threadId: failure.result?.threadId ?? prev.threadId,
          error: failure.error,
          toolStatusLabel: null,
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
            toolStatusLabel: null,
          }));
        },
        onError: (messageText) => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: messageText,
            toolStatusLabel: null,
          }));
        },
        onToolStatus: (event) => {
          setState((prev) => ({
            ...prev,
            toolStatusLabel: deriveToolStatusLabel(prev.toolStatusLabel, event),
          }));
        },
        onPendingAction: (event) => {
          setState((prev) => ({
            ...prev,
            pendingActions: [
              ...prev.pendingActions,
              {
                actionId: event.actionId,
                actionType: event.actionType,
                summary: event.summary,
                payload: event.payload,
                expiresAt: event.expiresAt,
              },
            ],
          }));
        },
        onPendingActionsBatch: (event) => {
          setState((prev) => ({
            ...prev,
            pendingActions: event.actions.map((a) => ({
              actionId: a.actionId,
              actionType: a.actionType,
              summary: a.summary,
              payload: a.payload,
              expiresAt: a.expiresAt,
            })),
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
        if (responseThreadId) {
          return { threadId: responseThreadId, interrupted: true };
        }
        return null;
      }
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: err instanceof Error ? err.message : "Unknown error",
        toolStatusLabel: null,
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
