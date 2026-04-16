"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Sparkles, PanelLeftClose, PanelLeft } from "lucide-react";
import Link from "next/link";
import { useAIStream } from "@/hooks/useAIStream";
import { getAssistantCapabilitySnapshot } from "@/lib/ai/capabilities";
import { prepareImageUpload } from "@/lib/media/image-preparation";
import { routeToSurface } from "@/components/ai-assistant/route-surface";
import {
  clearPersistedActiveThreadId,
  readPersistedActiveThreadId,
  writePersistedActiveThreadId,
} from "@/components/ai-assistant/active-thread-storage";
import {
  applyThreadDeletion,
  createOptimisticUserMessage,
  removePanelMessage,
  resolveRetryRequestIdentity,
  type AIPanelMessage,
  type PendingActionState,
  type AIPanelThread,
  type RetryRequestIdentity,
} from "@/components/ai-assistant/panel-state";
import type { AIChatAttachment } from "@/hooks/useAIStream";
import { ConversationSidebar } from "./ConversationSidebar";
import { ChatArea } from "./ChatArea";
import { ChatInput } from "./ChatInput";

interface AssistantLayoutProps {
  orgId: string;
  orgSlug: string;
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
    return "This class could not be added because the calendar database is missing the Class event type.";
  }
  return typeof data.error === "string" && data.error.trim().length > 0
    ? data.error
    : "Failed to confirm";
}

function getStarterPrompts(): string[] {
  return [
    "What events are coming up?",
    "Show me recent announcements",
    "How many active members do we have?",
    "What discussions are happening?",
  ];
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

export function AssistantLayout({ orgId, orgSlug }: AssistantLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const surface = routeToSurface(pathname);
  const capabilitySnapshot = getAssistantCapabilitySnapshot(pathname, surface);
  const starterPrompts = getStarterPrompts();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<AIPanelThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
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
  const idempotencyRef = useRef<RetryRequestIdentity | null>(null);
  const skipEffectLoadRef = useRef(false);

  useEffect(() => {
    attachmentRef.current = attachment;
  }, [attachment]);

  const deleteUploadedAttachment = useCallback(
    async (storagePath: string, options?: { keepalive?: boolean }) => {
      try {
        await fetch(`/api/ai/${orgId}/upload-schedule`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath }),
          keepalive: options?.keepalive ?? false,
        });
      } catch {
        // Non-fatal
      }
    },
    [orgId]
  );

  const clearAttachment = useCallback(
    (options?: { deleteRemote?: boolean; nextAttachment?: AIChatAttachment | null }) => {
      const currentAttachment = attachmentRef.current;
      const nextAttachment = options?.nextAttachment ?? null;

      attachmentRef.current = nextAttachment;
      setAttachment(nextAttachment);
      setAttachmentError(null);

      if (
        options?.deleteRemote !== false &&
        currentAttachment &&
        currentAttachment.storagePath !== nextAttachment?.storagePath
      ) {
        void deleteUploadedAttachment(currentAttachment.storagePath);
      }
    },
    [deleteUploadedAttachment]
  );

  // Cleanup attachment on unmount
  useEffect(
    () => () => {
      const currentAttachment = attachmentRef.current;
      if (!currentAttachment) return;
      void deleteUploadedAttachment(currentAttachment.storagePath, { keepalive: true });
    },
    [deleteUploadedAttachment]
  );

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const response = await fetch(`/api/ai/${orgId}/threads`);
      if (!response.ok) return;
      const data = await response.json();
      setThreads(data.data ?? []);
    } catch {
      // Leave existing state
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
        return false;
      } finally {
        setMessagesLoading(false);
      }
    },
    [clearAttachment, loadThreads, orgId, surface]
  );

  // Load threads on mount
  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Restore persisted thread
  useEffect(() => {
    if (typeof window === "undefined") return;
    const persistedThreadId = readPersistedActiveThreadId(window.localStorage, orgId, surface);
    if (persistedThreadId) {
      setActiveThreadId((current) => current ?? persistedThreadId);
    }
  }, [orgId, surface]);

  // Persist active thread
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeThreadId) {
      writePersistedActiveThreadId(window.localStorage, orgId, surface, activeThreadId);
    } else {
      clearPersistedActiveThreadId(window.localStorage, orgId, surface);
    }
  }, [activeThreadId, orgId, surface]);

  // Sync pending actions from stream
  useEffect(() => {
    if (streamPendingActions.length > 0) {
      setPendingActions(streamPendingActions);
      setPendingActionErrors({});
    }
  }, [streamPendingActions]);

  // Load messages when thread changes
  useEffect(() => {
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
  }, [activeThreadId, clearAttachment, loadMessages]);

  const handleAttachFile = useCallback(
    async (file: File) => {
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
        setDraftInput((current) => (current.trim() ? current : DEFAULT_SCHEDULE_FILE_PROMPT));
        clearError();
      } catch (error) {
        setAttachmentError(
          error instanceof Error ? error.message : "Failed to upload schedule file."
        );
      } finally {
        setAttachmentUploading(false);
      }
    },
    [clearAttachment, clearError, orgId]
  );

  const handleRemoveAttachment = useCallback(() => {
    if (attachmentUploading || isStreaming) return;
    clearAttachment();
  }, [attachmentUploading, clearAttachment, isStreaming]);

  const handleSend = useCallback(
    async (content: string) => {
      setPendingAssistantContent(null);
      setPendingActions([]);
      setPendingActionErrors({});

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

  const handleConfirmPendingAction = useCallback(
    async (actionId: string, options: { reloadCollections?: boolean; refreshCalendar?: boolean } = {}) => {
      const shouldReloadCollections = options.reloadCollections ?? true;
      const shouldRefreshCalendar = options.refreshCalendar ?? true;
      setPendingActionBusyIds((prev) => new Set(prev).add(actionId));
      setPendingActionErrors((prev) => {
        const next = { ...prev };
        delete next[actionId];
        return next;
      });
      try {
        const response = await fetch(`/api/ai/${orgId}/pending-actions/${actionId}/confirm`, {
          method: "POST",
        });
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
    },
    [activeThreadId, loadMessages, loadThreads, orgId, router]
  );

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

  const handleCancelPendingAction = useCallback(
    async (actionId: string) => {
      setPendingActionBusyIds((prev) => new Set(prev).add(actionId));
      setPendingActionErrors((prev) => {
        const next = { ...prev };
        delete next[actionId];
        return next;
      });
      try {
        const response = await fetch(`/api/ai/${orgId}/pending-actions/${actionId}/cancel`, {
          method: "POST",
        });
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
    },
    [activeThreadId, loadMessages, loadThreads, orgId]
  );

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

      const nextState = applyThreadDeletion(threads, activeThreadId, messages, threadId);
      setThreads(nextState.threads);
      setActiveThreadId(nextState.activeThreadId);
      setMessages(nextState.messages);
    },
    [activeThreadId, messages, orgId, threads]
  );

  const handleNewThread = useCallback(() => {
    setActiveThreadId(null);
    setMessages([]);
    setDraftInput("");
    clearAttachment();
    setPendingAssistantContent(null);
    setPendingActions([]);
  }, [clearAttachment]);

  const handleSelectThread = useCallback(
    (id: string) => {
      setDraftInput("");
      clearAttachment();
      setPendingAssistantContent(null);
      setPendingActions([]);
      setActiveThreadId(id);
    },
    [clearAttachment]
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] lg:h-screen">
      {/* Sidebar */}
      <ConversationSidebar
        threads={threads}
        loading={threadsLoading}
        activeThreadId={activeThreadId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onSelectThread={handleSelectThread}
        onNewThread={handleNewThread}
        onDeleteThread={handleDeleteThread}
      />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col overflow-hidden bg-background">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/${orgSlug}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>

            <div className="h-5 w-px bg-border/50" />

            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-org-secondary/10">
                <Sparkles className="h-4 w-4 text-org-secondary" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-foreground">AI Assistant</h1>
                <p className="text-[10px] text-muted-foreground">TeamNetwork tasks</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            aria-label={sidebarCollapsed ? "Show conversations" : "Hide conversations"}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
        </header>

        {/* Chat area */}
        <ChatArea
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

        {/* Input */}
        <ChatInput
          input={draftInput}
          isStreaming={isStreaming}
          isUploadingAttachment={attachmentUploading}
          error={error}
          attachmentError={attachmentError}
          attachment={attachment}
          toolStatusLabel={toolStatusLabel}
          placeholder="Ask anything about your organization..."
          onInputChange={setDraftInput}
          onSend={handleSend}
          onAttachFile={handleAttachFile}
          onRemoveAttachment={handleRemoveAttachment}
          onCancel={cancel}
          onClearError={clearError}
        />
      </div>
    </div>
  );
}
