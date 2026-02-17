"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Database } from "@/types/database";

type ThreadType = Database["public"]["Tables"]["discussion_threads"]["Row"] & {
  author: { name: string } | null;
};

type ReplyType = Database["public"]["Tables"]["discussion_replies"]["Row"] & {
  author: { name: string } | null;
};

interface ThreadDetailProps {
  thread: ThreadType;
  replies: ReplyType[];
  isAdmin: boolean;
  orgSlug: string;
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ThreadDetail({ thread, replies, isAdmin, orgSlug }: ThreadDetailProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);

  const togglePin = async () => {
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/discussions/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pinned: !thread.is_pinned }),
      });

      if (response.ok) {
        router.refresh();
      }
    } catch (error) {
      // Error is handled silently
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

      if (response.ok) {
        router.refresh();
      }
    } catch (error) {
      // Error is handled silently
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
        router.push(`/${orgSlug}/discussions`);
      }
    } catch (error) {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Thread */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-foreground mb-2">{thread.title}</h2>
            <div className="text-sm text-muted-foreground">
              Posted by {thread.author?.name || "Unknown"} on {formatDateTime(thread.created_at)}
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
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
          )}
        </div>
        <div className="prose max-w-none">
          <p className="whitespace-pre-wrap text-foreground">{thread.body}</p>
        </div>
      </Card>

      {/* Replies */}
      {replies.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">
            {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
          </h3>
          {replies.map((reply) => (
            <Card key={reply.id} className="p-4">
              <div className="text-sm text-muted-foreground mb-2">
                {reply.author?.name || "Unknown"} • {formatDateTime(reply.created_at)}
              </div>
              <div className="prose max-w-none">
                <p className="whitespace-pre-wrap text-foreground">{reply.body}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
