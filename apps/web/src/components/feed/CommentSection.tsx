"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { createCommentSchema } from "@/lib/schemas/feed";
import type { Database } from "@/types/database";

type CommentWithAuthor = Database["public"]["Tables"]["feed_comments"]["Row"] & {
  author: { name: string } | null;
};

interface CommentSectionProps {
  postId: string;
  comments: CommentWithAuthor[];
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

export function CommentSection({ postId, comments }: CommentSectionProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = createCommentSchema.safeParse({ body });
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      setError(firstError.message);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/feed/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to post comment");
        setIsSubmitting(false);
        return;
      }

      setBody("");
      router.refresh();
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {comments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">
            {comments.length} {comments.length === 1 ? "Comment" : "Comments"}
          </h3>
          {comments.map((comment) => (
            <Card key={comment.id} className="p-4">
              <div className="text-sm text-muted-foreground mb-2">
                <span className="font-medium text-foreground">{comment.author?.name || "Unknown"}</span>
                {" · "}
                {formatDateTime(comment.created_at)}
              </div>
              <p className="whitespace-pre-wrap text-foreground">{comment.body}</p>
            </Card>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-800 dark:text-red-300 text-sm">
            {error}
          </div>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment..."
          rows={3}
          maxLength={2000}
        />
        <Button type="submit" disabled={isSubmitting || !body.trim()}>
          {isSubmitting ? "Posting..." : "Comment"}
        </Button>
      </form>
    </div>
  );
}
