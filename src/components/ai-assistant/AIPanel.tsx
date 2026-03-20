"use client";

import { useState } from "react";
import { X, MessageSquare, List } from "lucide-react";
import { useAIPanel } from "./AIPanelContext";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ThreadList } from "./ThreadList";

interface AIPanelProps {
  orgId: string;
}

export function AIPanel({ orgId }: AIPanelProps) {
  const { isOpen, closePanel } = useAIPanel();
  const [view, setView] = useState<"chat" | "threads">("chat");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

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
          <MessageList orgId={orgId} threadId={activeThreadId} />
          <MessageInput orgId={orgId} threadId={activeThreadId} onThreadCreated={setActiveThreadId} />
        </div>
      ) : (
        <ThreadList
          orgId={orgId}
          activeThreadId={activeThreadId}
          onSelectThread={(id) => {
            setActiveThreadId(id);
            setView("chat");
          }}
          onNewThread={() => {
            setActiveThreadId(null);
            setView("chat");
          }}
        />
      )}
    </div>
  );
}
