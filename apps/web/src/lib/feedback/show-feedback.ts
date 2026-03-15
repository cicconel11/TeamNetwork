import { toast } from "sonner";

interface FeedbackOptions {
  duration?: number;
}

/**
 * Show a toast notification via Sonner.
 * Centralizes all imperative toast calls — prefer this over importing `toast` directly.
 */
export function showFeedback(
  message: string,
  variant: "success" | "error" | "warning" | "info" = "info",
  options?: FeedbackOptions,
): void {
  switch (variant) {
    case "success":
      toast.success(message, options);
      break;
    case "error":
      toast.error(message, options);
      break;
    case "warning":
      toast.warning(message, options);
      break;
    case "info":
      toast(message, options);
      break;
  }
}
