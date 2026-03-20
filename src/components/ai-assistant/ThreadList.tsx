"use client";

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
  const handleDelete = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm("Delete this conversation?");
    if (!confirmed) return;

    await onDeleteThread(threadId);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border p-3">
        <button
          onClick={onNewThread}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : threads.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No conversations yet
          </p>
        ) : (
          <div className="divide-y divide-border">
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`group flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted ${
                  activeThreadId === thread.id ? "bg-indigo-50 dark:bg-indigo-900/20" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectThread(thread.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 truncate">
                    <p className="truncate font-medium text-foreground">
                      {thread.title ?? "Untitled conversation"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatThreadUpdatedAt(thread.updated_at)}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDelete(thread.id, e)}
                  aria-label="Delete thread"
                  className="rounded p-1 text-muted-foreground opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/20"
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
