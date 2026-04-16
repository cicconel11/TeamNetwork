"use client";

import { useState, useCallback } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import type { AIFeedbackRating } from "@/lib/schemas";

interface MessageFeedbackProps {
  messageId: string;
  orgId: string;
  initialRating?: AIFeedbackRating | null;
}

export function MessageFeedback({
  messageId,
  orgId,
  initialRating = null,
}: MessageFeedbackProps) {
  const [rating, setRating] = useState<AIFeedbackRating | null>(initialRating);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitFeedback = useCallback(
    async (newRating: AIFeedbackRating) => {
      if (isSubmitting) return;

      // Toggle off if clicking same rating
      const targetRating = rating === newRating ? null : newRating;

      // Optimistic update
      setRating(targetRating);

      if (!targetRating) {
        // No API to delete feedback yet, just clear local state
        return;
      }

      setIsSubmitting(true);
      try {
        const res = await fetch(`/api/ai/${orgId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, rating: targetRating }),
        });

        if (!res.ok) {
          // Revert on failure
          setRating(rating);
        }
      } catch {
        // Revert on error
        setRating(rating);
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageId, orgId, rating, isSubmitting]
  );

  return (
    <div className="mt-1 flex items-center gap-1">
      <button
        type="button"
        onClick={() => void submitFeedback("positive")}
        disabled={isSubmitting}
        className={`rounded p-1 transition-colors ${
          rating === "positive"
            ? "bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        aria-label="Helpful"
        title="Helpful"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => void submitFeedback("negative")}
        disabled={isSubmitting}
        className={`rounded p-1 transition-colors ${
          rating === "negative"
            ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        aria-label="Not helpful"
        title="Not helpful"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
