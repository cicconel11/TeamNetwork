"use client";

import { useState, useCallback } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FeedbackModal, type FeedbackContext } from "./FeedbackModal";

export interface FeedbackButtonProps {
  /** Page context where the button is shown (e.g., "login", "join-org") */
  context: string;
  /** Friction type that triggered the feedback (e.g., "login_error", "invite_failed") */
  trigger: string;
  /** Optional additional CSS classes */
  className?: string;
}

export function FeedbackButton({ context, trigger, className = "" }: FeedbackButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [feedbackContext, setFeedbackContext] = useState<FeedbackContext | null>(null);

  const handleOpenModal = useCallback(() => {
    const ctx: FeedbackContext = {
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      timestamp: new Date().toISOString(),
      triggerType: `${context}:${trigger}`,
    };
    setFeedbackContext(ctx);
    setIsModalOpen(true);
  }, [context, trigger]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleSubmit = useCallback(async (data: {
    message: string;
    screenshot?: File;
    context: FeedbackContext;
  }) => {
    // TODO: Implement API call to submit feedback
    // For now, just log the submission
    const formData = new FormData();
    formData.append("message", data.message);
    formData.append("pageUrl", data.context.pageUrl);
    formData.append("userAgent", data.context.userAgent);
    formData.append("timestamp", data.context.timestamp);
    formData.append("triggerType", data.context.triggerType);

    if (data.screenshot) {
      formData.append("screenshot", data.screenshot);
    }

    const response = await fetch("/api/feedback", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to submit feedback");
    }
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleOpenModal}
        className={className}
        aria-label="Send feedback"
      >
        <MessageSquare className="h-4 w-4" />
        <span>Feedback</span>
      </Button>

      {isModalOpen && feedbackContext && (
        <FeedbackModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          context={feedbackContext}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}
