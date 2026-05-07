"use client";

import { useState } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import type { AIPanelThread } from "./panel-state";
import { formatThreadUpdatedAt } from "./thread-date";

interface ThreadListProps {
  threads: AIPanelThread[];
  loading: boolean;
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (threadId: string) => Promise<void>;
}

export function ThreadList({
  threads,
  loading,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: ThreadListProps) {
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* New conversation button */}
      <div className="p-3">
        <button
          onClick={onNewThread}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-3 py-2.5 text-sm font-medium text-foreground transition-all hover:border-org-secondary hover:bg-org-secondary/5 hover:text-org-secondary"
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
              Start a new conversation
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`group relative rounded-xl transition-all ${
                  activeThreadId === thread.id
                    ? "bg-org-secondary/10"
                    : "hover:bg-muted/50"
                } ${deletingId === thread.id ? "opacity-50" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectThread(thread.id)}
                  disabled={deletingId === thread.id}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                >
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    activeThreadId === thread.id
                      ? "bg-org-secondary/20"
                      : "bg-muted/70"
                  }`}>
                    <MessageSquare className={`h-3.5 w-3.5 ${
                      activeThreadId === thread.id
                        ? "text-org-secondary"
                        : "text-muted-foreground"
                    }`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${
                      activeThreadId === thread.id
                        ? "text-org-secondary"
                        : "text-foreground"
                    }`}>
                      {thread.title ?? "Untitled"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatThreadUpdatedAt(thread.updated_at)}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDelete(thread.id, e)}
                  disabled={deletingId === thread.id}
                  aria-label="Delete conversation"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
