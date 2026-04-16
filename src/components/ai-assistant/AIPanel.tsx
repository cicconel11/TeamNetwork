"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, MessageSquare, List, Sparkles } from "lucide-react";
import { useAIStream } from "@/hooks/useAIStream";
import { getAssistantCapabilitySnapshot } from "@/lib/ai/capabilities";
import { prepareImageUpload } from "@/lib/media/image-preparation";
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
import type { AIChatAttachment } from "@/hooks/useAIStream";

interface AIPanelProps {
  orgId: string;
}

const DEFAULT_SCHEDULE_FILE_PROMPT =
  "Please extract this schedule file and prepare events for confirmation.";
const MAX_SCHEDULE_IMAGE_BYTES = 2 * 1024 * 1024;
const SCHEDULE_IMAGE_MIME_TYPES = new Set<AIChatAttachment["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

function getPendingActionErrorMessage(data: { error?: unknown; code?: unknown }): string {
  if (data.code === "event_type_unavailable") {
    return "This class could not be added because the calendar database is missing the Class event type. The environment needs the latest event-type migration before you can confirm class drafts.";
  }

  return typeof data.error === "string" && data.error.trim().length > 0
    ? data.error
    : "Failed to confirm";
}

function getFeatureSegment(pathname: string): string {
  return (
    pathname.match(/^\/enterprise\/[^/]+\/([^/?#]+)/)?.[1] ??
    pathname.match(/^\/[^/]+\/([^/?#]+)/)?.[1] ??
    ""
  );
}

function getAssistantScopeLabel(pathname: string, surface: ReturnType<typeof routeToSurface>): string {
  const segment = getFeatureSegment(pathname);
  const isEnterprisePath = pathname.startsWith("/enterprise/");
  if (isEnterprisePath && segment === "alumni") {
    return "Enterprise Alumni";
  }
  if (isEnterprisePath && segment === "billing") {
    return "Enterprise Billing";
  }
  if (isEnterprisePath && segment === "organizations") {
    return "Managed Orgs";
  }

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
  }

  if (isEnterprisePath) {
    return "Enterprise";
  }

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

function getStarterPrompts(pathname: string, surface: ReturnType<typeof routeToSurface>): string[] {
  const segment = getFeatureSegment(pathname);
  const isEnterprisePath = pathname.startsWith("/enterprise/");
  if (isEnterprisePath && segment === "alumni") {
    return [
      "How many alumni do we have across all orgs?",
      "Show alumni from one managed org",
      "Which managed orgs are in this enterprise?",
    ];
  }
  if (isEnterprisePath && segment === "billing") {
    return [
      "How many alumni seats are left?",
      "How many sub-org slots are left?",
      "Show our enterprise quota snapshot",
    ];
  }
  if (isEnterprisePath && segment === "organizations") {
    return [
      "List our managed orgs",
      "How many orgs are enterprise-managed?",
      "Which orgs are using our pooled seats?",
    ];
  }

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
  }

  if (isEnterprisePath) {
    return [
      "How many alumni do we have across all orgs?",
      "How many sub-org slots are left?",
      "List our managed orgs",
    ];
  }

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

function getInputPlaceholder(pathname: string, surface: ReturnType<typeof routeToSurface>): string {
  const segment = getFeatureSegment(pathname);
  const isEnterprisePath = pathname.startsWith("/enterprise/");
  if (segment === "alumni" && isEnterprisePath) {
    return "Ask about alumni across all managed orgs, counts, or filters...";
  }
  if ((segment === "billing" || segment === "organizations") && isEnterprisePath) {
    return "Ask about enterprise quota, managed orgs, or cross-org totals...";
  }
  if (isEnterprisePath) {
    return "Ask about alumni, managed orgs, enterprise quota, or cross-org totals...";
  }
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

async function normalizeScheduleUploadFile(file: File): Promise<File> {
  if (!SCHEDULE_IMAGE_MIME_TYPES.has(file.type as AIChatAttachment["mimeType"])) {
    return file;
  }

  const preparedUpload = await prepareImageUpload(file);

  try {
    if (preparedUpload.normalizedBytes > MAX_SCHEDULE_IMAGE_BYTES) {
      throw new Error(
        "That schedule image is too large to process. Please upload an image under 2MB or use a PDF instead."
      );
    }

    return preparedUpload.file;
  } finally {
    if (preparedUpload.previewUrl) {
      URL.revokeObjectURL(preparedUpload.previewUrl);
    }
  }
}

export function AIPanel({ orgId }: AIPanelProps) {
  const { isOpen, closePanel } = useAIPanel();
  const pathname = usePathname();
  const router = useRouter();
  const surface = routeToSurface(pathname);
  const scopeLabel = getAssistantScopeLabel(pathname, surface);
  const capabilitySnapshot = getAssistantCapabilitySnapshot(pathname, surface);
  const starterPrompts = getStarterPrompts(pathname, surface);
  const inputPlaceholder = getInputPlaceholder(pathname, surface);
  const [view, setView] = useState<"chat" | "threads">("chat");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<AIPanelThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [messages, setMessages] = useState<AIPanelMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draftInput, setDraftInput] = useState("");
  const [attachment, setAttachment] = useState<AIChatAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [pendingAssistantContent, setPendingAssistantContent] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingActionState[]>([]);
  const [pendingActionBusyIds, setPendingActionBusyIds] = useState<Set<string>>(new Set());
  const [pendingActionErrors, setPendingActionErrors] = useState<Record<string, string>>({});
  const panelScopeKey = orgId;
  const {
    isStreaming,
    error,
    currentContent,
    toolStatusLabel,
    pendingActions: streamPendingActions,
    sendMessage,
    cancel,
    clearError,
  } = useAIStream({ orgId });
  const attachmentRef = useRef<AIChatAttachment | null>(null);

  useEffect(() => {
    attachmentRef.current = attachment;
  }, [attachment]);

  const deleteUploadedAttachment = useCallback(async (
    storagePath: string,
    options?: { keepalive?: boolean }
  ) => {
    try {
      await fetch(`/api/ai/${orgId}/upload-schedule`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath }),
        keepalive: options?.keepalive ?? false,
      });
    } catch {
      // Deletion failures are non-fatal — the upload is being discarded anyway.
    }
  }, [orgId]);

  const clearAttachment = useCallback((options?: {
    deleteRemote?: boolean;
    nextAttachment?: AIChatAttachment | null;
  }) => {
    const currentAttachment = attachmentRef.current;
    const nextAttachment = options?.nextAttachment ?? null;

    attachmentRef.current = nextAttachment;
    setAttachment(nextAttachment);
    setAttachmentError(null);

    if (
      options?.deleteRemote !== false
      && currentAttachment
      && currentAttachment.storagePath !== nextAttachment?.storagePath
    ) {
      void deleteUploadedAttachment(currentAttachment.storagePath);
    }
  }, [deleteUploadedAttachment]);

  useEffect(() => () => {
    const currentAttachment = attachmentRef.current;
    if (!currentAttachment) {
      return;
    }

    void deleteUploadedAttachment(currentAttachment.storagePath, { keepalive: true });
  }, [deleteUploadedAttachment]);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const response = await fetch(`/api/ai/${orgId}/threads`);
      if (!response.ok) return;
      const data = await response.json();
      setThreads(data.data ?? []);
    } catch {
      // Leave the existing UI state intact on transient fetch errors.
    } finally {
      setThreadsLoading(false);
    }
  }, [orgId]);

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
          setDraftInput("");
          clearAttachment();
          setPendingAssistantContent(null);
          setPendingActions([]);
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
    [clearAttachment, loadThreads, orgId, surface]
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
    setDraftInput("");
    clearAttachment();
    setPendingAssistantContent(null);
    setPendingActions([]);
    void loadThreads();
  }, [clearAttachment, loadThreads, panelScopeKey]);

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
    if (streamPendingActions.length > 0) {
      setPendingActions(streamPendingActions);
      setPendingActionErrors({});
    }
  }, [streamPendingActions]);

  useEffect(() => {
    if (!isOpen) return;
    if (!activeThreadId) {
      setMessages([]);
      setMessagesLoading(false);
      setDraftInput("");
      clearAttachment();
      setPendingAssistantContent(null);
      setPendingActions([]);
      return;
    }
    if (skipEffectLoadRef.current) {
      skipEffectLoadRef.current = false;
      return;
    }
    void loadMessages(activeThreadId);
  }, [activeThreadId, clearAttachment, isOpen, loadMessages]);

  // Track the last sent content + key so retries of the same message reuse the key
  const idempotencyRef = useRef<RetryRequestIdentity | null>(null);

  const handleAttachFile = useCallback(async (file: File) => {
    setAttachmentError(null);
    setAttachmentUploading(true);

    try {
      const normalizedFile = await normalizeScheduleUploadFile(file);
      const formData = new FormData();
      formData.set("file", normalizedFile);

      const response = await fetch(`/api/ai/${orgId}/upload-schedule`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({ error: "Upload failed" }));

      if (!response.ok) {
        setAttachmentError(data.error || "Failed to upload schedule file.");
        return;
      }

      clearAttachment({
        deleteRemote: true,
        nextAttachment: {
          storagePath: data.storagePath,
          fileName: data.fileName,
          mimeType: data.mimeType,
        },
      });
      setDraftInput((current) => current.trim() ? current : DEFAULT_SCHEDULE_FILE_PROMPT);
      clearError();
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Failed to upload schedule file."
      );
    } finally {
      setAttachmentUploading(false);
    }
  }, [clearAttachment, clearError, orgId]);

  const handleRemoveAttachment = useCallback(() => {
    if (attachmentUploading || isStreaming) return;
    clearAttachment();
  }, [attachmentUploading, clearAttachment, isStreaming]);

  const handleSend = useCallback(
    async (content: string) => {
      setPendingAssistantContent(null);
      setPendingActions([]);
      setPendingActionErrors({});

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
        attachment: attachmentRef.current ?? undefined,
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

      const sendSucceeded = !result.inFlight && !result.interrupted;

      const [loadedMessages] = await Promise.all([
        loadMessages(result.threadId, { silent: true }),
        loadThreads(),
      ]);

      if (sendSucceeded) {
        setDraftInput("");
        clearAttachment({ deleteRemote: false });
      }

      if (loadedMessages) {
        setPendingAssistantContent(null);
      }
    },
    [activeThreadId, clearAttachment, loadMessages, loadThreads, pathname, sendMessage, surface]
  );

  const handleConfirmPendingAction = useCallback(async (
    actionId: string,
    options: { reloadCollections?: boolean; refreshCalendar?: boolean } = {}
  ) => {
    const shouldReloadCollections = options.reloadCollections ?? true;
    const shouldRefreshCalendar = options.refreshCalendar ?? true;
    setPendingActionBusyIds((prev) => new Set(prev).add(actionId));
    setPendingActionErrors((prev) => {
      const next = { ...prev };
      delete next[actionId];
      return next;
    });
    try {
      const response = await fetch(
        `/api/ai/${orgId}/pending-actions/${actionId}/confirm`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({ error: "Request failed" }));
      if (!response.ok) {
        setPendingActionErrors((prev) => ({
          ...prev,
          [actionId]: getPendingActionErrorMessage(data),
        }));
        return;
      }

      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
      if (shouldReloadCollections && activeThreadId) {
        await Promise.all([loadMessages(activeThreadId, { silent: true }), loadThreads()]);
      }
      if (shouldRefreshCalendar) {
        window.dispatchEvent(new CustomEvent("calendar:refresh"));
        router.refresh();
      }
    } finally {
      setPendingActionBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(actionId);
        return next;
      });
    }
  }, [activeThreadId, loadMessages, loadThreads, orgId, router]);

  const handleConfirmAllPendingActions = useCallback(async () => {
    const ids = pendingActions.map((a) => a.actionId);
    for (const id of ids) {
      await handleConfirmPendingAction(id, { reloadCollections: false, refreshCalendar: false });
    }
    if (activeThreadId) {
      await Promise.all([loadMessages(activeThreadId, { silent: true }), loadThreads()]);
    }
    window.dispatchEvent(new CustomEvent("calendar:refresh"));
    router.refresh();
  }, [activeThreadId, handleConfirmPendingAction, loadMessages, loadThreads, pendingActions, router]);

  const handleCancelPendingAction = useCallback(async (actionId: string) => {
    setPendingActionBusyIds((prev) => new Set(prev).add(actionId));
    setPendingActionErrors((prev) => {
      const next = { ...prev };
      delete next[actionId];
      return next;
    });
    try {
      const response = await fetch(
        `/api/ai/${orgId}/pending-actions/${actionId}/cancel`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({ error: "Request failed" }));
      if (!response.ok) {
        setPendingActionErrors((prev) => ({ ...prev, [actionId]: data.error || "Failed to cancel" }));
        return;
      }

      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
      if (activeThreadId) {
        await Promise.all([loadMessages(activeThreadId, { silent: true }), loadThreads()]);
      }
    } finally {
      setPendingActionBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(actionId);
        return next;
      });
    }
  }, [activeThreadId, loadMessages, loadThreads, orgId]);

  const handleCancelAllPendingActions = useCallback(async () => {
    const ids = pendingActions.map((a) => a.actionId);
    await Promise.allSettled(ids.map((id) => handleCancelPendingAction(id)));
  }, [pendingActions, handleCancelPendingAction]);

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
        className="fixed inset-0 z-[45] bg-black/30 backdrop-blur-sm sm:hidden"
        onClick={closePanel}
        aria-hidden="true"
      />

      {/* Panel - Gemini style */}
      <div className="ai-panel-enter fixed top-0 right-0 bottom-0 z-[45] flex w-full flex-col border-l border-border bg-background shadow-2xl sm:w-[420px]">
        {/* Header - minimal, clean */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-org-secondary/20 to-org-secondary/5">
              <Sparkles className="h-5 w-5 text-org-secondary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Assistant</h2>
              <span className="text-[10px] text-muted-foreground">{scopeLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setView(view === "chat" ? "threads" : "chat")}
              aria-label={view === "chat" ? "Show conversations" : "Back to chat"}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {view === "chat" ? <List className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
            </button>
            <button
              onClick={closePanel}
              aria-label="Close"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
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
              orgId={orgId}
              streamingContent={currentContent}
              isStreaming={isStreaming}
              previewAssistantContent={pendingAssistantContent ?? undefined}
              suggestedPrompts={starterPrompts}
              onSelectPrompt={handleSend}
              capabilitySnapshot={capabilitySnapshot}
              pendingActions={pendingActions}
              pendingActionBusyIds={pendingActionBusyIds}
              pendingActionErrors={pendingActionErrors}
              onConfirmPendingAction={handleConfirmPendingAction}
              onCancelPendingAction={handleCancelPendingAction}
              onConfirmAllPendingActions={handleConfirmAllPendingActions}
              onCancelAllPendingActions={handleCancelAllPendingActions}
            />
            <MessageInput
              input={draftInput}
              isStreaming={isStreaming}
              isUploadingAttachment={attachmentUploading}
              error={error}
              attachmentError={attachmentError}
              attachment={attachment}
              toolStatusLabel={toolStatusLabel}
              placeholder={inputPlaceholder}
              onInputChange={setDraftInput}
              onSend={handleSend}
              onAttachFile={handleAttachFile}
              onRemoveAttachment={handleRemoveAttachment}
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
              setDraftInput("");
              clearAttachment();
              setPendingAssistantContent(null);
              setPendingActions([]);
              setActiveThreadId(id);
              setView("chat");
            }}
            onNewThread={() => {
              setActiveThreadId(null);
              setMessages([]);
              setDraftInput("");
              clearAttachment();
              setPendingAssistantContent(null);
              setPendingActions([]);
              setView("chat");
            }}
            onDeleteThread={handleDeleteThread}
          />
        )}
      </div>
    </>
  );
}
