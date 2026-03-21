"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, MessageSquare, List, Sparkles } from "lucide-react";
import { useAIStream } from "@/hooks/useAIStream";
import { useAIPanel } from "./AIPanelContext";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ThreadList } from "./ThreadList";
import {
  applyThreadDeletion,
  createOptimisticUserMessage,
  removePanelMessage,
  resolveRetryRequestIdentity,
  type AIPanelMessage,
  type AIPanelThread,
  type RetryRequestIdentity,
} from "./panel-state";

interface AIPanelProps {
  orgId: string;
}

export function AIPanel({ orgId }: AIPanelProps) {
  const { isOpen, closePanel } = useAIPanel();
  const [view, setView] = useState<"chat" | "threads">("chat");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<AIPanelThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messages, setMessages] = useState<AIPanelMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const {
    isStreaming,
    error,
    currentContent,
    sendMessage,
    cancel,
    clearError,
  } = useAIStream({ orgId });

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const response = await fetch(`/api/ai/${orgId}/threads`);
      if (!response.ok) return;
      const data = await response.json();
      setThreads(data.threads ?? []);
    } catch {
      // Leave the existing UI state intact on transient fetch errors.
    } finally {
      setThreadsLoading(false);
    }
  }, [orgId]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      setMessagesLoading(true);
      try {
        const response = await fetch(`/api/ai/${orgId}/threads/${threadId}/messages`);
        if (response.status === 404) {
          setActiveThreadId(null);
          setMessages([]);
          void loadThreads();
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        setMessages(data.messages ?? []);
      } catch {
        // Keep the current message list on transient fetch errors.
      } finally {
        setMessagesLoading(false);
      }
    },
    [loadThreads, orgId]
  );

  useEffect(() => {
    if (!isOpen) return;
    void loadThreads();
  }, [isOpen, loadThreads]);

  useEffect(() => {
    if (!isOpen) return;
    if (!activeThreadId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }
    void loadMessages(activeThreadId);
  }, [activeThreadId, isOpen, loadMessages]);

  // Track the last sent content + key so retries of the same message reuse the key
  const idempotencyRef = useRef<RetryRequestIdentity | null>(null);

  const handleSend = useCallback(
    async (content: string) => {
      // Reuse keys only for retries of the same content within the same thread.
      const requestIdentity = resolveRetryRequestIdentity(
        idempotencyRef.current,
        content,
        activeThreadId,
        () => crypto.randomUUID()
      );
      idempotencyRef.current = requestIdentity;
      const idempotencyKey = requestIdentity.key;

      const optimisticMessage = createOptimisticUserMessage(
        content,
        new Date().toISOString(),
        `optimistic-${idempotencyKey}`
      );
      setMessages((msgs) => [...msgs, optimisticMessage]);

      const result = await sendMessage(content, {
        surface: "general",
        threadId: activeThreadId ?? undefined,
        idempotencyKey,
      });

      if (!result) {
        setMessages((msgs) => removePanelMessage(msgs, optimisticMessage.id));
        if (activeThreadId) {
          await loadMessages(activeThreadId);
        }
        return;
      }

      // Keep the retry key while the original server request is still in flight.
      if (!result.inFlight) {
        idempotencyRef.current = null;
      }

      if (result.threadId !== activeThreadId) {
        setActiveThreadId(result.threadId);
      }

      await Promise.all([
        loadMessages(result.threadId),
        loadThreads(),
      ]);
    },
    [activeThreadId, loadMessages, loadThreads, sendMessage]
  );

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      const response = await fetch(`/api/ai/${orgId}/threads/${threadId}`, {
        method: "DELETE",
      });
      if (!response.ok) return;

      setView("threads");
      const nextState = applyThreadDeletion(threads, activeThreadId, messages, threadId);
      setThreads(nextState.threads);
      setActiveThreadId(nextState.activeThreadId);
      setMessages(nextState.messages);
    },
    [activeThreadId, messages, orgId, threads]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[45] bg-black/20 sm:hidden"
        onClick={closePanel}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="ai-panel-enter fixed top-0 right-0 bottom-0 z-[45] flex w-full flex-col border-l border-border bg-background shadow-2xl sm:w-96">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-foreground">AI Assistant</h2>
            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400">
              Beta
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView(view === "chat" ? "threads" : "chat")}
              aria-label={view === "chat" ? "Show thread list" : "Show chat"}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {view === "chat" ? <List className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
            </button>
            <button
              onClick={closePanel}
              aria-label="Close AI assistant"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        {view === "chat" ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <MessageList
              messages={messages}
              loading={messagesLoading}
              streamingContent={currentContent}
              isStreaming={isStreaming}
            />
            <MessageInput
              isStreaming={isStreaming}
              error={error}
              onSend={handleSend}
              onCancel={cancel}
              onClearError={clearError}
            />
          </div>
        ) : (
          <ThreadList
            threads={threads}
            loading={threadsLoading}
            activeThreadId={activeThreadId}
            onSelectThread={(id) => {
              setActiveThreadId(id);
              setView("chat");
            }}
            onNewThread={() => {
              setActiveThreadId(null);
              setMessages([]);
              setView("chat");
            }}
            onDeleteThread={handleDeleteThread}
          />
        )}
      </div>
    </>
  );
}
