"use client";

import { useCallback, useEffect, useState } from "react";
import { X, MessageSquare, List } from "lucide-react";
import { useAIStream } from "@/hooks/useAIStream";
import { useAIPanel } from "./AIPanelContext";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ThreadList } from "./ThreadList";
import {
  applyThreadDeletion,
  createOptimisticUserMessage,
  removePanelMessage,
  type AIPanelMessage,
  type AIPanelThread,
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

  const handleSend = useCallback(
    async (content: string) => {
      const optimisticMessage = createOptimisticUserMessage(
        content,
        new Date().toISOString(),
        `optimistic-${crypto.randomUUID()}`
      );
      setMessages((prev) => [...prev, optimisticMessage]);

      const result = await sendMessage(content, {
        surface: "general",
        threadId: activeThreadId ?? undefined,
        idempotencyKey: crypto.randomUUID(),
      });

      if (!result) {
        setMessages((prev) => removePanelMessage(prev, optimisticMessage.id));
        if (activeThreadId) {
          await loadMessages(activeThreadId);
        }
        return;
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
      await loadThreads();
    },
    [activeThreadId, loadThreads, messages, orgId, threads]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 z-40 flex w-full flex-col border-l border-gray-200 bg-white shadow-xl sm:w-96 dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">AI Assistant</h2>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView(view === "chat" ? "threads" : "chat")}
            aria-label={view === "chat" ? "Show thread list" : "Show chat"}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            {view === "chat" ? <List className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          </button>
          <button
            onClick={closePanel}
            aria-label="Close AI assistant"
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
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
  );
}
