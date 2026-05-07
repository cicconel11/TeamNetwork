"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, User, Sparkles, ArrowRight } from "lucide-react";
import type { AssistantCapabilitySnapshot } from "@/lib/ai/capabilities";
import type { AIPanelMessage, PendingActionState } from "@/components/ai-assistant/panel-state";
import type { AIFeedbackRating } from "@/lib/schemas";
import { AssistantMessageContent } from "@/components/ai-assistant/AssistantMessageContent";
import { MessageFeedback } from "@/components/ai-assistant/MessageFeedback";
import { PendingActionCard } from "@/components/ai-assistant/PendingActionCard";

interface ChatAreaProps {
  messages: AIPanelMessage[];
  loading: boolean;
  orgId: string;
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

export function ChatArea({
  messages,
  loading,
  orgId,
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
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, AIFeedbackRating>>({});
  const fetchedIdsRef = useRef<Set<string>>(new Set());

  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && Boolean(message.content));
  const shouldRenderPreviewAssistant =
    Boolean(previewAssistantContent) &&
    lastAssistantMessage?.content !== previewAssistantContent;

  // Fetch feedback for complete assistant messages
  useEffect(() => {
    const completeAssistantIds = messages
      .filter((m) => m.role === "assistant" && m.status === "complete")
      .map((m) => m.id)
      .filter((id) => !fetchedIdsRef.current.has(id));

    if (completeAssistantIds.length === 0) return;

    const controller = new AbortController();
    const fetchFeedback = async () => {
      try {
        const res = await fetch(
          `/api/ai/${orgId}/feedback?messageIds=${completeAssistantIds.join(",")}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;

        const json = (await res.json()) as {
          data: Array<{ message_id: string; rating: AIFeedbackRating }>;
        };
        const newMap: Record<string, AIFeedbackRating> = {};
        for (const item of json.data) {
          newMap[item.message_id] = item.rating;
          fetchedIdsRef.current.add(item.message_id);
        }
        for (const id of completeAssistantIds) {
          fetchedIdsRef.current.add(id);
        }
        if (Object.keys(newMap).length > 0) {
          setFeedbackMap((prev) => ({ ...prev, ...newMap }));
        }
      } catch {
        // Ignore abort errors
      }
    };

    void fetchFeedback();
    return () => controller.abort();
  }, [messages, orgId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent, previewAssistantContent]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-org-secondary border-t-transparent" />
      </div>
    );
  }

  // Empty state - prominent welcome screen
  if (!messages.length && !streamingContent && !previewAssistantContent) {
    const hasCapabilities =
      capabilitySnapshot &&
      (capabilitySnapshot.supported.length > 0 || capabilitySnapshot.unsupported.length > 0);

    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl space-y-8 text-center">
          {/* Hero icon */}
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-org-secondary/20 to-org-secondary/5 shadow-lg shadow-org-secondary/10">
            <Sparkles className="h-10 w-10 text-org-secondary" />
          </div>

          {/* Welcome text */}
          <div className="space-y-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
              How can I help today?
            </h1>
            <p className="mx-auto max-w-md text-base text-muted-foreground">
              Ask about members, events, announcements, discussions, or any TeamNetwork task for
              your organization.
            </p>
          </div>

          {/* Suggested prompts */}
          {suggestedPrompts && suggestedPrompts.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Try asking:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestedPrompts.slice(0, 4).map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void onSelectPrompt?.(prompt)}
                    className="group flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground shadow-sm transition-all hover:border-org-secondary/50 hover:bg-org-secondary/5 hover:shadow-md"
                  >
                    {prompt}
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-org-secondary" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Capabilities disclosure */}
          {hasCapabilities && (
            <details className="mx-auto max-w-md rounded-xl border border-border bg-card/50 px-4 py-3 text-left">
              <summary className="cursor-pointer select-none list-none text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between">
                  <span>What I can do here</span>
                  <span className="text-muted-foreground transition-transform group-open:rotate-180">
                    +
                  </span>
                </span>
              </summary>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                {capabilitySnapshot.supported.map((capability) => (
                  <p key={capability.toolName} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-org-secondary" />
                    {capability.description}
                  </p>
                ))}
                {capabilitySnapshot.unsupported.map((item) => (
                  <p key={item} className="flex items-start gap-2 text-muted-foreground/70">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/30" />
                    Not yet: {item}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  }

  // Message list
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {messages
          .filter((message) => message.role !== "system")
          .map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-org-secondary/20 to-org-secondary/10 shadow-sm">
                  <Bot className="h-5 w-5 text-org-secondary" />
                </div>
              )}

              <div
                className={`max-w-[85%] overflow-hidden rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-org-secondary text-org-secondary-foreground shadow-sm"
                    : "bg-muted/70"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="space-y-3 break-words [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background/50 [&_pre]:p-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-left">
                    <AssistantMessageContent content={msg.content ?? ""} />
                    {msg.status === "complete" && (
                      <MessageFeedback
                        messageId={msg.id}
                        orgId={orgId}
                        initialRating={feedbackMap[msg.id] ?? null}
                      />
                    )}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{msg.content ?? ""}</div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted shadow-sm">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

        {/* Preview assistant content */}
        {shouldRenderPreviewAssistant && (
          <div className="flex gap-4 justify-start">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-org-secondary/20 to-org-secondary/10 shadow-sm">
              <Bot className="h-5 w-5 text-org-secondary" />
            </div>
            <div className="max-w-[85%] overflow-hidden rounded-2xl bg-muted/70 px-4 py-3 text-sm leading-relaxed">
              <div className="space-y-3 break-words [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background/50 [&_pre]:p-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-left">
                <AssistantMessageContent content={previewAssistantContent ?? ""} />
              </div>
            </div>
          </div>
        )}

        {/* Streaming content */}
        {isStreaming && streamingContent && (
          <div className="flex gap-4 justify-start">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-org-secondary/20 to-org-secondary/10 shadow-sm">
              <Bot className="h-5 w-5 text-org-secondary" />
            </div>
            <div className="max-w-[85%] overflow-hidden rounded-2xl bg-muted/70 px-4 py-3 text-sm leading-relaxed">
              <div className="space-y-3 break-words [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background/50 [&_pre]:p-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-left">
                <AssistantMessageContent content={streamingContent} />
              </div>
              <span className="ml-1 inline-block h-5 w-0.5 animate-pulse rounded-full bg-org-secondary" />
            </div>
          </div>
        )}

        {/* Pending actions */}
        {pendingActions && pendingActions.length > 0 && (
          <div className="space-y-3">
            {pendingActions.length > 1 && (
              <div className="flex items-center justify-between rounded-xl border border-org-secondary/30 bg-org-secondary/5 px-4 py-3">
                <span className="text-sm font-medium text-org-secondary">
                  Review {pendingActions.length} events
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
                    onClick={() => void onCancelAllPendingActions?.()}
                  >
                    Cancel All
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-org-secondary px-3 py-1.5 text-xs font-medium text-org-secondary-foreground shadow-sm transition-colors hover:bg-org-secondary-dark"
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
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
