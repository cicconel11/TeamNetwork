"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";

interface Thread {
  id: string;
  title: string | null;
  surface: string;
  updated_at: string;
}

interface ThreadListProps {
  orgId: string;
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}

export function ThreadList({ orgId, activeThreadId, onSelectThread, onNewThread }: ThreadListProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ai/${orgId}/threads`)
      .then(res => res.json())
      .then(data => setThreads(data.threads ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleDelete = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm("Delete this conversation?");
    if (!confirmed) return;

    await fetch(`/api/ai/${orgId}/threads/${threadId}`, { method: "DELETE" });
    setThreads(prev => prev.filter(t => t.id !== threadId));
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-gray-200 p-3 dark:border-gray-700">
        <button
          onClick={onNewThread}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
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
          <p className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No conversations yet
          </p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {threads.map(thread => (
              <button
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  activeThreadId === thread.id ? "bg-indigo-50 dark:bg-indigo-900/20" : ""
                }`}
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-gray-400" />
                <div className="flex-1 truncate">
                  <p className="truncate font-medium text-gray-900 dark:text-white">
                    {thread.title ?? "Untitled conversation"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(thread.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDelete(thread.id, e)}
                  aria-label="Delete thread"
                  className="rounded p-1 text-gray-400 opacity-0 hover:bg-gray-200 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-gray-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
