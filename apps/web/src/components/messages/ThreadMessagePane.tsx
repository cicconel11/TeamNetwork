"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserContent } from "@/components/i18n/UserContent";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { MessageTopBar } from "@/components/messages/MessageTopBar";
import type { Database } from "@/types/database";

type ThreadType = Database["public"]["Tables"]["discussion_threads"]["Row"] & {
  author: { name: string } | null;
};

type ReplyType = Database["public"]["Tables"]["discussion_replies"]["Row"] & {
  author: { name: string } | null;
};

interface ThreadMessagePaneProps {
  thread: ThreadType;
  replies: ReplyType[];
  isAdmin: boolean;
  orgSlug: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(dateString: string): string {
  const d = new Date(dateString);
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

export function ThreadMessagePane({ thread, replies, isAdmin, orgSlug }: ThreadMessagePaneProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const togglePin = async () => {
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/discussions/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pinned: !thread.is_pinned }),
      });
      if (response.ok) router.refresh();
    } catch {
      // handled silently
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleLock = async () => {
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/discussions/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_locked: !thread.is_locked }),
      });
      if (response.ok) router.refresh();
    } catch {
      // handled silently
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteThread = async () => {
    if (!confirm("Are you sure you want to delete this thread? This action cannot be undone.")) {
      return;
    }
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/discussions/${thread.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        router.push(`/${orgSlug}/messages`);
      }
    } catch {
      setIsUpdating(false);
    }
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setReplyError(null);

    try {
      const response = await fetch(`/api/discussions/${thread.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        setReplyError(result.error || "Failed to post reply");
        setIsSubmitting(false);
        return;
      }

      setReplyBody("");
      router.refresh();
    } catch {
      setReplyError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <MessageTopBar
        title={thread.title}
        translateTitle
        actions={
          isAdmin ? (
            <div className="flex items-center gap-1">
              <Button onClick={togglePin} disabled={isUpdating} variant="ghost" size="sm">
                {thread.is_pinned ? "Unpin" : "Pin"}
              </Button>
              <Button onClick={toggleLock} disabled={isUpdating} variant="ghost" size="sm">
                {thread.is_locked ? "Unlock" : "Lock"}
              </Button>
              <Button onClick={deleteThread} disabled={isUpdating} variant="ghost" size="sm">
                Delete
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Thread header card */}
        <div className="bg-muted/50 rounded-lg p-4 border border-border">
          <div className="text-sm text-muted-foreground mb-2">
            Posted by <UserContent>{thread.author?.name || "Unknown"}</UserContent> &middot; {formatDateTime(thread.created_at)}
          </div>
          <div className="prose max-w-none">
            <UserContent as="p" className="whitespace-pre-wrap text-foreground text-sm leading-relaxed">
              {thread.body}
            </UserContent>
          </div>
        </div>

        {/* Replies in chat-style */}
        {replies.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold px-1 py-2">
              {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
            </div>
            {replies.map((reply, index) => {
              const prevReply = index > 0 ? replies[index - 1] : null;
              const isGrouped =
                prevReply &&
                prevReply.author_id === reply.author_id &&
                new Date(reply.created_at).getTime() - new Date(prevReply.created_at).getTime() < 5 * 60 * 1000;

              return (
                <div key={reply.id} className={`flex gap-3 ${isGrouped ? "mt-0.5" : "mt-3"}`}>
                  <div className="w-8 flex-shrink-0">
                    {!isGrouped && (
                      <Avatar
                        name={reply.author?.name || "Unknown"}
                        size="sm"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {!isGrouped && (
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-foreground">
                          <UserContent>{reply.author?.name || "Unknown"}</UserContent>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(reply.created_at)}
                        </span>
                      </div>
                    )}
                    <div className="bg-muted rounded-lg px-3 py-2 inline-block max-w-[85%]">
                      <UserContent as="p" className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {reply.body}
                      </UserContent>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      {thread.is_locked ? (
        <div className="border-t border-border p-3 text-center">
          <p className="text-sm text-muted-foreground">This thread is locked. No new replies can be added.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmitReply} className="border-t border-border p-3">
          {replyError && (
            <div className="p-2 mb-2 rounded bg-red-500/10 text-red-500 text-sm">{replyError}</div>
          )}
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type a reply..."
              className="flex-1 px-4 py-2 rounded-lg bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-[var(--color-org-secondary)] text-sm"
              disabled={isSubmitting}
            />
            <Button type="submit" disabled={!replyBody.trim() || isSubmitting} size="sm">
              {isSubmitting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
