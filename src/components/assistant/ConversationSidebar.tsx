"use client";

import { useState } from "react";
import { Plus, MessageSquare, Trash2, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { AIPanelThread } from "@/components/ai-assistant/panel-state";
import { formatThreadUpdatedAt } from "@/components/ai-assistant/thread-date";

interface ConversationSidebarProps {
  threads: AIPanelThread[];
  loading: boolean;
  activeThreadId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (threadId: string) => Promise<void>;
}

type ThreadGroup = {
  label: string;
  threads: AIPanelThread[];
};

function groupThreadsByTime(threads: AIPanelThread[]): ThreadGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  const groups: Record<string, AIPanelThread[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    "This Month": [],
    Older: [],
  };

  for (const thread of threads) {
    const date = new Date(thread.updated_at);
    if (date >= today) {
      groups.Today.push(thread);
    } else if (date >= yesterday) {
      groups.Yesterday.push(thread);
    } else if (date >= weekAgo) {
      groups["This Week"].push(thread);
    } else if (date >= monthAgo) {
      groups["This Month"].push(thread);
    } else {
      groups.Older.push(thread);
    }
  }

  return Object.entries(groups)
    .filter(([, threads]) => threads.length > 0)
    .map(([label, threads]) => ({ label, threads }));
}

export function ConversationSidebar({
  threads,
  loading,
  activeThreadId,
  collapsed,
  onToggleCollapse,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: ConversationSidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm("Delete this conversation?");
    if (!confirmed) return;

    setDeletingId(threadId);
    try {
      await onDeleteThread(threadId);
    } finally {
      setDeletingId(null);
    }
  };

  const groupedThreads = groupThreadsByTime(threads);

  if (collapsed) {
    return (
      <div className="flex h-full w-16 flex-col border-r border-border/50 bg-card/50 backdrop-blur-sm">
        <button
          onClick={onToggleCollapse}
          className="flex h-14 items-center justify-center border-b border-border/50 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <button
          onClick={onNewThread}
          className="flex h-14 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="New conversation"
        >
          <Plus className="h-5 w-5" />
        </button>
        <div className="flex-1 overflow-y-auto">
          {threads.slice(0, 8).map((thread) => (
            <button
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className={`flex h-12 w-full items-center justify-center transition-colors hover:bg-muted/50 ${
                activeThreadId === thread.id
                  ? "bg-org-secondary/10 text-org-secondary"
                  : "text-muted-foreground"
              }`}
              aria-label={thread.title ?? "Conversation"}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-72 flex-col border-r border-border/50 bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border/50 px-4">
        <h2 className="font-display text-sm font-semibold tracking-tight text-foreground">
          Conversations
        </h2>
        <button
          onClick={onToggleCollapse}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* New conversation button */}
      <div className="p-3">
        <button
          onClick={onNewThread}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/50 px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:border-org-secondary hover:bg-org-secondary/5 hover:text-org-secondary"
        >
          <Plus className="h-4 w-4" />
          New conversation
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-org-secondary border-t-transparent" />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 rounded-full bg-muted/50 p-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No conversations yet</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Start a new conversation to get help
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedThreads.map((group) => (
              <div key={group.label}>
                {/* Time group header with timeline connector */}
                <div className="relative mb-2 flex items-center gap-2 pl-3">
                  <div className="absolute left-0 top-1/2 h-px w-2 bg-border/70" />
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {group.label}
                  </span>
                </div>

                {/* Threads with timeline */}
                <div className="relative ml-1 border-l border-border/50 pl-3">
                  {group.threads.map((thread, idx) => (
                    <div
                      key={thread.id}
                      className={`group relative ${idx !== group.threads.length - 1 ? "mb-1" : ""}`}
                    >
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[calc(0.75rem+1.5px)] top-3 h-2 w-2 rounded-full border-2 transition-colors ${
                          activeThreadId === thread.id
                            ? "border-org-secondary bg-org-secondary"
                            : "border-border bg-card group-hover:border-org-secondary/50"
                        }`}
                      />

                      <button
                        type="button"
                        onClick={() => onSelectThread(thread.id)}
                        disabled={deletingId === thread.id}
                        className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-all ${
                          activeThreadId === thread.id
                            ? "bg-org-secondary/10"
                            : "hover:bg-muted/50"
                        } ${deletingId === thread.id ? "opacity-50" : ""}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm font-medium ${
                              activeThreadId === thread.id
                                ? "text-org-secondary"
                                : "text-foreground"
                            }`}
                          >
                            {thread.title ?? "Untitled"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatThreadUpdatedAt(thread.updated_at)}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleDelete(thread.id, e)}
                          disabled={deletingId === thread.id}
                          aria-label="Delete conversation"
                          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
