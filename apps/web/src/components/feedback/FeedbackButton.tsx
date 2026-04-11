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

  const handleSubmit = useCallback(
    async (data: {
      message: string;
      screenshot?: File;
      context: FeedbackContext;
    }) => {
      let screenshotUrl: string | undefined;
      if (data.screenshot) {
        const up = new FormData();
        up.append("file", data.screenshot);
        up.append("context", context);
        up.append("trigger", trigger);
        const shotRes = await fetch("/api/feedback/screenshot", {
          method: "POST",
          body: up,
        });
        const shotJson = await shotRes.json().catch(() => ({}));
        if (!shotRes.ok) {
          throw new Error(shotJson.error || "Failed to upload screenshot");
        }
        if (typeof shotJson.screenshot_url === "string") {
          screenshotUrl = shotJson.screenshot_url;
        }
      }

      const payload = {
        message: data.message,
        page_url: data.context.pageUrl,
        user_agent: data.context.userAgent,
        context,
        trigger,
        ...(screenshotUrl ? { screenshot_url: screenshotUrl } : {}),
      };

      const response = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to submit feedback");
      }
    },
    [context, trigger],
  );

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
