"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X, MessageSquare, List, Sparkles } from "lucide-react";
import { useAIStream } from "@/hooks/useAIStream";
import { useAIPanel } from "./AIPanelContext";
import { routeToSurface } from "./route-surface";
import {
  clearPersistedActiveThreadId,
  readPersistedActiveThreadId,
  writePersistedActiveThreadId,
} from "./active-thread-storage";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ThreadList } from "./ThreadList";
import {
  applyThreadDeletion,
  createOptimisticUserMessage,
  removePanelMessage,
  resolveRetryRequestIdentity,
  type AIPanelMessage,
  type PendingActionState,
  type AIPanelThread,
  type RetryRequestIdentity,
} from "./panel-state";

interface AIPanelProps {
  orgId: string;
}

function getFeatureSegment(pathname: string): string {
  return pathname.match(/^\/[^/]+\/([^/?#]+)/)?.[1] ?? "";
}

function getAssistantScopeLabel(pathname: string, surface: ReturnType<typeof routeToSurface>): string {
  const segment = getFeatureSegment(pathname);
  switch (segment) {
    case "announcements":
      return "Announcements";
    case "jobs":
      return "Jobs";
    case "forms":
      return "Forms";
    case "discussions":
      return "Discussions";
    case "messages":
    case "chat":
      return "Messages";
    default:
      switch (surface) {
        case "members":
          return "People";
        case "events":
          return "Events";
        case "analytics":
          return "Analytics";
        default:
          return "General";
      }
  }
}

function getStarterPrompts(pathname: string, surface: ReturnType<typeof routeToSurface>): string[] {
  const segment = getFeatureSegment(pathname);
  switch (segment) {
    case "announcements":
      return [
        "Show the latest announcements",
        "Open the new announcement page",
        "Summarize our recent announcements",
      ];
    case "jobs":
      return [
        "Open the jobs page",
        "Take me to create a job posting",
        "Where do I manage jobs?",
      ];
    case "forms":
      return [
        "Open the forms page",
        "Take me to create a form",
        "Where do I manage form submissions?",
      ];
    case "discussions":
      return [
        "What discussions are happening?",
        "Show pinned discussions",
        "Open the discussions page",
      ];
    default:
      switch (surface) {
        case "members":
          return [
            "How many active members do we have?",
            "Show recent members",
            "Open the members page",
          ];
        case "events":
          return [
            "What events are coming up?",
            "Open the new event page",
            "Show recent events",
          ];
        case "analytics":
          return [
            "Show organization stats",
            "Open donations",
            "Take me to navigation settings",
          ];
        default:
          return [
            "Show recent announcements",
            "What discussions are happening?",
            "What jobs are we advertising?",
          ];
      }
  }
}

function getInputPlaceholder(pathname: string, surface: ReturnType<typeof routeToSurface>): string {
  const segment = getFeatureSegment(pathname);
  if (segment === "announcements") {
    return "Ask about announcements, or ask me to open the right page...";
  }
  if (segment === "discussions") {
    return "Ask about discussions, threads, or where to go in the app...";
  }

  switch (surface) {
    case "members":
      return "Ask about people, connections, or where to go in the app...";
    case "events":
      return "Ask about events, or ask me to open the right page...";
    case "analytics":
      return "Ask about stats, donations, or where to go in the app...";
    default:
      return "Ask about announcements, discussions, jobs, or where to go...";
  }
}

export function AIPanel({ orgId }: AIPanelProps) {
  const { isOpen, closePanel } = useAIPanel();
  const pathname = usePathname();
  const surface = routeToSurface(pathname);
  const scopeLabel = getAssistantScopeLabel(pathname, surface);
  const starterPrompts = getStarterPrompts(pathname, surface);
  const inputPlaceholder = getInputPlaceholder(pathname, surface);
  const [view, setView] = useState<"chat" | "threads">("chat");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<AIPanelThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messages, setMessages] = useState<AIPanelMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [pendingAssistantContent, setPendingAssistantContent] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null);
  const [pendingActionBusy, setPendingActionBusy] = useState(false);
  const [pendingActionError, setPendingActionError] = useState<string | null>(null);
  const panelScopeKey = `${orgId}:${surface}`;
  const {
    isStreaming,
    error,
    currentContent,
    toolStatusLabel,
    pendingAction: streamPendingAction,
    sendMessage,
    cancel,
    clearError,
  } = useAIStream({ orgId });

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const response = await fetch(
        `/api/ai/${orgId}/threads?surface=${encodeURIComponent(surface)}`
      );
      if (!response.ok) return;
      const data = await response.json();
      setThreads(data.data ?? []);
    } catch {
      // Leave the existing UI state intact on transient fetch errors.
    } finally {
      setThreadsLoading(false);
    }
  }, [orgId, surface]);

  const loadMessages = useCallback(
    async (threadId: string, options?: { silent?: boolean }): Promise<boolean> => {
      if (!options?.silent) {
        setMessagesLoading(true);
      }
      try {
        const response = await fetch(`/api/ai/${orgId}/threads/${threadId}/messages`);
        if (response.status === 404) {
          if (typeof window !== "undefined") {
            clearPersistedActiveThreadId(window.localStorage, orgId, surface);
          }
          setActiveThreadId(null);
          setMessages([]);
          setPendingAssistantContent(null);
          setPendingAction(null);
          void loadThreads();
          return false;
        }
        if (!response.ok) return false;
        const data = await response.json();
        setMessages(data.messages ?? []);
        return true;
      } catch {
        // Keep the current message list on transient fetch errors.
        return false;
      } finally {
        setMessagesLoading(false);
      }
    },
    [loadThreads, orgId, surface]
  );

  useEffect(() => {
    if (!isOpen) return;
    void loadThreads();
  }, [isOpen, loadThreads]);

  const prevPanelScopeKeyRef = useRef(panelScopeKey);
  useEffect(() => {
    if (prevPanelScopeKeyRef.current === panelScopeKey) {
      return;
    }

    prevPanelScopeKeyRef.current = panelScopeKey;
    setActiveThreadId(null);
    setMessages([]);
    setPendingAssistantContent(null);
    setPendingAction(null);
    void loadThreads();
  }, [loadThreads, panelScopeKey]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;

    const persistedThreadId = readPersistedActiveThreadId(
      window.localStorage,
      orgId,
      surface
    );

    if (persistedThreadId) {
      setActiveThreadId((current) => current ?? persistedThreadId);
    }
  }, [isOpen, orgId, surface]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (activeThreadId) {
      writePersistedActiveThreadId(window.localStorage, orgId, surface, activeThreadId);
      return;
    }

    clearPersistedActiveThreadId(window.localStorage, orgId, surface);
  }, [activeThreadId, orgId, surface]);

  // Skip the activeThreadId effect's redundant load after handleSend already
  // refreshed messages silently.
  const skipEffectLoadRef = useRef(false);

  useEffect(() => {
    if (streamPendingAction) {
      setPendingAction(streamPendingAction);
      setPendingActionError(null);
    }
  }, [streamPendingAction]);

  useEffect(() => {
    if (!isOpen) return;
    if (!activeThreadId) {
      setMessages([]);
      setMessagesLoading(false);
      setPendingAssistantContent(null);
      setPendingAction(null);
      return;
    }
    if (skipEffectLoadRef.current) {
      skipEffectLoadRef.current = false;
      return;
    }
    void loadMessages(activeThreadId);
  }, [activeThreadId, isOpen, loadMessages]);

  // Track the last sent content + key so retries of the same message reuse the key
  const idempotencyRef = useRef<RetryRequestIdentity | null>(null);

  const handleSend = useCallback(
    async (content: string) => {
      setPendingAssistantContent(null);
      setPendingAction(null);
      setPendingActionError(null);

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
        surface,
        currentPath: pathname,
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
        skipEffectLoadRef.current = true;
        setActiveThreadId(result.threadId);
      }

      if (result.content) {
        setPendingAssistantContent(result.content);
      }

      const [loadedMessages] = await Promise.all([
        loadMessages(result.threadId, { silent: true }),
        loadThreads(),
      ]);

      if (loadedMessages) {
        setPendingAssistantContent(null);
      }
    },
    [activeThreadId, loadMessages, loadThreads, pathname, sendMessage, surface]
  );

  const handleConfirmPendingAction = useCallback(async () => {
    if (!pendingAction) return;

    setPendingActionBusy(true);
    setPendingActionError(null);
    try {
      const response = await fetch(
        `/api/ai/${orgId}/pending-actions/${pendingAction.actionId}/confirm`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({ error: "Request failed" }));
      if (!response.ok) {
        setPendingActionError(data.error || "Failed to confirm pending action");
        return;
      }

      setPendingAction(null);
      if (activeThreadId) {
        await Promise.all([loadMessages(activeThreadId, { silent: true }), loadThreads()]);
      }
      window.dispatchEvent(new CustomEvent("calendar:refresh"));
    } finally {
      setPendingActionBusy(false);
    }
  }, [activeThreadId, loadMessages, loadThreads, orgId, pendingAction]);

  const handleCancelPendingAction = useCallback(async () => {
    if (!pendingAction) return;

    setPendingActionBusy(true);
    setPendingActionError(null);
    try {
      const response = await fetch(
        `/api/ai/${orgId}/pending-actions/${pendingAction.actionId}/cancel`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({ error: "Request failed" }));
      if (!response.ok) {
        setPendingActionError(data.error || "Failed to cancel pending action");
        return;
      }

      setPendingAction(null);
      if (activeThreadId) {
        await Promise.all([loadMessages(activeThreadId, { silent: true }), loadThreads()]);
      }
    } finally {
      setPendingActionBusy(false);
    }
  }, [activeThreadId, loadMessages, loadThreads, orgId, pendingAction]);

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
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {scopeLabel}
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
              previewAssistantContent={pendingAssistantContent ?? undefined}
              suggestedPrompts={starterPrompts}
              onSelectPrompt={handleSend}
              pendingAction={pendingAction}
              pendingActionBusy={pendingActionBusy}
              pendingActionError={pendingActionError}
              onConfirmPendingAction={handleConfirmPendingAction}
              onCancelPendingAction={handleCancelPendingAction}
            />
            <MessageInput
              isStreaming={isStreaming}
              error={error}
              toolStatusLabel={toolStatusLabel}
              placeholder={inputPlaceholder}
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
              setPendingAssistantContent(null);
              setPendingAction(null);
              setActiveThreadId(id);
              setView("chat");
            }}
            onNewThread={() => {
              setActiveThreadId(null);
              setMessages([]);
              setPendingAssistantContent(null);
              setPendingAction(null);
              setView("chat");
            }}
            onDeleteThread={handleDeleteThread}
          />
        )}
      </div>
    </>
  );
}
