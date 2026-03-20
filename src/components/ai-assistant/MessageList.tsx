"use client";

import { useEffect, useState } from "react";
import { Bot, User } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  status: string;
  created_at: string;
}

interface MessageListProps {
  orgId: string;
  threadId: string | null;
  streamingContent?: string;
  isStreaming?: boolean;
}

export function MessageList({ orgId, threadId, streamingContent, isStreaming }: MessageListProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    fetch(`/api/ai/${orgId}/threads/${threadId}/messages`)
      .then(res => res.json())
      .then(data => {
        setMessages(data.messages ?? []);
      })
      .catch(() => {
        // Silent fail — messages will be empty
      })
      .finally(() => setLoading(false));
  }, [orgId, threadId]);

  if (!threadId && !streamingContent) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div>
          <Bot className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            Ask me about your organization...
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.filter(m => m.role !== "system").map(msg => (
        <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          {msg.role === "assistant" && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900">
              <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
          )}
          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
            msg.role === "user"
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          }`}>
            {msg.content ?? ""}
          </div>
          {msg.role === "user" && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
              <User className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            </div>
          )}
        </div>
      ))}
      {isStreaming && streamingContent && (
        <div className="flex gap-3 justify-start">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900">
            <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">
            {streamingContent}
            <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-indigo-500" />
          </div>
        </div>
      )}
    </div>
  );
}
