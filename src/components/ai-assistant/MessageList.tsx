"use client";

import { useEffect, useRef } from "react";
import { Bot, User, Sparkles } from "lucide-react";
import type { AssistantCapabilitySnapshot } from "@/lib/ai/capabilities";
import type { AIPanelMessage, PendingActionState } from "./panel-state";
import { AssistantMessageContent } from "./AssistantMessageContent";
import { PendingActionCard } from "./PendingActionCard";

interface MessageListProps {
  messages: AIPanelMessage[];
  loading: boolean;
  streamingContent?: string;
  isStreaming?: boolean;
  previewAssistantContent?: string;
  suggestedPrompts?: string[];
  onSelectPrompt?: (message: string) => Promise<void> | void;
  capabilitySnapshot?: AssistantCapabilitySnapshot;
  pendingActions?: PendingActionState[];
  pendingActionBusyIds?: Set<string>;
  pendingActionErrors?: Record<string, string>;
  onConfirmPendingAction?: (actionId: string) => Promise<void> | void;
  onCancelPendingAction?: (actionId: string) => Promise<void> | void;
  onConfirmAllPendingActions?: () => Promise<void> | void;
  onCancelAllPendingActions?: () => Promise<void> | void;
}

export function MessageList({
  messages,
  loading,
  streamingContent,
  isStreaming,
  previewAssistantContent,
  suggestedPrompts,
  onSelectPrompt,
  capabilitySnapshot,
  pendingActions,
  pendingActionBusyIds,
  pendingActionErrors,
  onConfirmPendingAction,
  onCancelPendingAction,
  onConfirmAllPendingActions,
  onCancelAllPendingActions,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && Boolean(message.content));
  const shouldRenderPreviewAssistant =
    Boolean(previewAssistantContent) &&
    lastAssistantMessage?.content !== previewAssistantContent;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent, previewAssistantContent]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!messages.length && !streamingContent && !previewAssistantContent) {
    const hasCapabilities =
      capabilitySnapshot &&
      (capabilitySnapshot.supported.length > 0 || capabilitySnapshot.unsupported.length > 0);

    return (
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-sm space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/50">
            <Sparkles className="h-6 w-6 text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">How can I help?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask about members, events, discussions, jobs, analytics, or anything about your organization.
            </p>
          </div>
          {suggestedPrompts && suggestedPrompts.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {suggestedPrompts.slice(0, 3).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void onSelectPrompt?.(prompt)}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
          {hasCapabilities ? (
            <details className="group rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-xs">
              <summary className="cursor-pointer select-none list-none font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
                What I can do here
                <span className="ml-1 text-muted-foreground group-open:hidden">+</span>
                <span className="ml-1 hidden text-muted-foreground group-open:inline">−</span>
              </summary>
              <div className="mt-2 space-y-1 text-muted-foreground">
                {capabilitySnapshot.supported.map((capability) => (
                  <p key={capability.toolName}>- {capability.description}</p>
                ))}
                {capabilitySnapshot.unsupported.map((item) => (
                  <p key={item}>- Not yet: {item}.</p>
                ))}
              </div>
            </details>
          ) : null}
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
      {shouldRenderPreviewAssistant && (
        <div className="flex gap-3 justify-start">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50">
            <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="max-w-[80%] overflow-hidden rounded-2xl bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            <div className="space-y-2 break-words [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-left">
              <AssistantMessageContent content={previewAssistantContent ?? ""} />
            </div>
          </div>
        </div>
      )}
      {isStreaming && streamingContent && (
        <div className="flex gap-3 justify-start">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50">
            <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="max-w-[80%] overflow-hidden rounded-2xl bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            <div className="space-y-2 break-words [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-left">
              <AssistantMessageContent content={streamingContent} />
            </div>
            <span className="ml-1 inline-block h-4 w-0.5 animate-pulse rounded-full bg-indigo-500" />
          </div>
        </div>
      )}
      {pendingActions && pendingActions.length > 0 ? (
        <div className="space-y-2">
          {pendingActions.length > 1 && (
            <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-950/50">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                Review {pendingActions.length} events
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700"
                  onClick={() => void onCancelAllPendingActions?.()}
                >
                  Cancel All
                </button>
                <button
                  type="button"
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-indigo-500"
                  onClick={() => void onConfirmAllPendingActions?.()}
                >
                  Confirm All
                </button>
              </div>
            </div>
          )}
          {pendingActions.map((action) => (
            <PendingActionCard
              key={action.actionId}
              action={action}
              busy={pendingActionBusyIds?.has(action.actionId)}
              error={pendingActionErrors?.[action.actionId] ?? null}
              onConfirm={() => void onConfirmPendingAction?.(action.actionId)}
              onCancel={() => void onCancelPendingAction?.(action.actionId)}
            />
          ))}
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
