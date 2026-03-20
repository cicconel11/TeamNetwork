"use client";

import { useEffect, useRef } from "react";
import { Bot, User, Sparkles } from "lucide-react";
import type { AIPanelMessage } from "./panel-state";
import { AssistantMessageContent } from "./AssistantMessageContent";

interface MessageListProps {
  messages: AIPanelMessage[];
  loading: boolean;
  streamingContent?: string;
  isStreaming?: boolean;
}

export function MessageList({ messages, loading, streamingContent, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!messages.length && !streamingContent) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/50">
            <Sparkles className="h-6 w-6 text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">How can I help?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask about members, events, analytics, or anything about your organization.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.filter((message) => message.role !== "system").map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {msg.role === "assistant" && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50">
              <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
          )}
          <div className={`max-w-[80%] overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            msg.role === "user"
              ? "bg-indigo-600 text-white"
              : "bg-muted text-foreground"
          }`}>
            {msg.role === "assistant" ? (
              <div className="space-y-2 break-words [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-left">
                <AssistantMessageContent content={msg.content ?? ""} />
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words">{msg.content ?? ""}</div>
            )}
          </div>
          {msg.role === "user" && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}
      {isStreaming && streamingContent && (
        <div className="flex gap-3 justify-start">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50">
            <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="max-w-[80%] overflow-hidden rounded-2xl bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            <div className="whitespace-pre-wrap break-words">
            {streamingContent}
            </div>
            <span className="ml-1 inline-block h-4 w-0.5 animate-pulse rounded-full bg-indigo-500" />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
