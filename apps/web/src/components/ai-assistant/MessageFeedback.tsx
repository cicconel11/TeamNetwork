"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const hasInteractedRef = useRef(false);

  // Sync from parent when initialRating changes (batch fetch completes)
  useEffect(() => {
    if (!hasInteractedRef.current) {
      setRating(initialRating);
    }
  }, [initialRating]);

  const submitFeedback = useCallback(
    async (newRating: AIFeedbackRating) => {
      if (isSubmitting) return;

      const previousRating = rating;
      // Toggle off if clicking same rating
      const targetRating = rating === newRating ? null : newRating;

      hasInteractedRef.current = true;

      // Optimistic update
      setRating(targetRating);

      setIsSubmitting(true);
      try {
        const res = targetRating
          ? await fetch(`/api/ai/${orgId}/feedback`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messageId, rating: targetRating }),
            })
          : await fetch(
              `/api/ai/${orgId}/feedback?messageId=${encodeURIComponent(messageId)}`,
              { method: "DELETE" }
            );

        if (!res.ok) {
          // Revert on failure
          setRating(previousRating);
        }
      } catch {
        // Revert on error
        setRating(previousRating);
      } finally {
        setIsSubmitting(false);
      }
    },
    [messageId, orgId, rating, isSubmitting]
  );

  return (
    <div className="mt-2.5 flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void submitFeedback("positive")}
        disabled={isSubmitting}
        className={`rounded-md p-1 transition-colors ${
          rating === "positive"
            ? "text-green-500 dark:text-green-400"
            : "text-muted-foreground/40 hover:text-muted-foreground"
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
        className={`rounded-md p-1 transition-colors ${
          rating === "negative"
            ? "text-red-500 dark:text-red-400"
            : "text-muted-foreground/40 hover:text-muted-foreground"
        }`}
        aria-label="Not helpful"
        title="Not helpful"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
