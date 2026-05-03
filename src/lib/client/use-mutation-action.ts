"use client";

import { useCallback, useState } from "react";
import { showFeedback } from "@/lib/feedback/show-feedback";

export interface MutationActionOptions<TArgs extends unknown[], TResult> {
  action: (...args: TArgs) => Promise<TResult>;
  successMessage?: string | ((result: TResult) => string | undefined);
  errorMessage?: string | ((error: unknown) => string | undefined);
  onSuccess?: (result: TResult) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export function getMutationErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function useMutationAction<TArgs extends unknown[], TResult>({
  action,
  successMessage,
  errorMessage,
  onSuccess,
  onError,
}: MutationActionOptions<TArgs, TResult>) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setIsPending(true);
      setError(null);
      try {
        const result = await action(...args);
        const message = typeof successMessage === "function" ? successMessage(result) : successMessage;
        if (message) showFeedback(message, "success", { duration: 3000 });
        await onSuccess?.(result);
        return result;
      } catch (caught) {
        const fallback = typeof errorMessage === "string" ? errorMessage : undefined;
        const message = typeof errorMessage === "function"
          ? errorMessage(caught) || getMutationErrorMessage(caught, fallback)
          : getMutationErrorMessage(caught, fallback);
        setError(message);
        showFeedback(message, "error", { duration: 4500 });
        onError?.(caught);
        return undefined;
      } finally {
        setIsPending(false);
      }
    },
    [action, errorMessage, onError, onSuccess, successMessage],
  );

  return { run, isPending, error, clearError: () => setError(null) };
}
