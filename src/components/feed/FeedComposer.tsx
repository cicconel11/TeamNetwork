"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createPostSchema } from "@/lib/schemas/feed";

interface FeedComposerProps {
  orgId: string;
}

export function FeedComposer({ orgId }: FeedComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = createPostSchema.safeParse({ body });
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      setError(firstError.message);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, body }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to create post");
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
    <Card className="p-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-800 dark:text-red-300 text-sm">
            {error}
          </div>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's on your mind?"
          rows={3}
          maxLength={5000}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting || !body.trim()}>
            {isSubmitting ? "Posting..." : "Post"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
