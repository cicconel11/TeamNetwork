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

  useEffect(() => {
    let cancelled = false;

    hasInteractedRef.current = false;
    setRating(initialRating);

    const loadPersistedRating = async () => {
      try {
        const res = await fetch(
          `/api/ai/${orgId}/feedback?messageId=${encodeURIComponent(messageId)}`
        );
        if (!res.ok) return;

        const body = await res.json();
        const nextRating =
          body?.data?.rating === "positive" || body?.data?.rating === "negative"
            ? body.data.rating
            : null;

        if (!cancelled && !hasInteractedRef.current) {
          setRating(nextRating);
        }
      } catch {
        // Leave the local state alone on transient fetch failures.
      }
    };

    void loadPersistedRating();

    return () => {
      cancelled = true;
    };
  }, [initialRating, messageId, orgId]);

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
