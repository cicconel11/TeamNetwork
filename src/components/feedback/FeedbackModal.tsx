"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button, Textarea } from "@/components/ui";

type FeedbackStatus = "idle" | "submitting" | "success" | "error";

export interface FeedbackContext {
  pageUrl: string;
  userAgent: string;
  timestamp: string;
  triggerType: string;
}

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: FeedbackContext;
  onSubmit: (data: {
    message: string;
    screenshot?: File;
    context: FeedbackContext;
  }) => Promise<void>;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

export function FeedbackModal({
  isOpen,
  onClose,
  context,
  onSubmit,
}: FeedbackModalProps) {
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<FeedbackStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const resetForm = useCallback(() => {
    setMessage("");
    setScreenshot(null);
    setScreenshotPreview(null);
    setStatus("idle");
    setError(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    },
    [isOpen, handleClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);

    if (!file) {
      setScreenshot(null);
      setScreenshotPreview(null);
      return;
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setFileError("Please upload a PNG, JPEG, or WebP image");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setFileError("File size must be under 5MB");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setScreenshot(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      setScreenshotPreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    setScreenshotPreview(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      setError("Please describe what blocked you");
      return;
    }

    setStatus("submitting");
    setError(null);

    try {
      await onSubmit({
        message: message.trim(),
        screenshot: screenshot ?? undefined,
        context,
      });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
      aria-hidden="false"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
    >
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id="feedback-modal-title" className="text-lg font-semibold text-foreground">
            Share Feedback
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
            aria-label="Close modal"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {status === "success" ? (
            <div className="text-center py-6">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-green-600 dark:text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                Thank you for your feedback
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                We appreciate you taking the time to help us improve.
              </p>
              <Button variant="secondary" onClick={handleClose}>
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Textarea
                label="What blocked you today?"
                placeholder="Tell us what got in your way, confused you, or didn't work as expected..."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error) setError(null);
                }}
                error={error ?? undefined}
                rows={4}
                disabled={status === "submitting"}
              />

              {/* Screenshot Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Screenshot (optional)
                </label>

                {screenshotPreview ? (
                  <div className="relative">
                    <img
                      src={screenshotPreview}
                      alt="Screenshot preview"
                      className="w-full h-32 object-cover rounded-lg border border-border"
                    />
                    <button
                      type="button"
                      onClick={removeScreenshot}
                      className="absolute top-2 right-2 p-1 bg-background/80 backdrop-blur-sm rounded-full text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Remove screenshot"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                      id="feedback-screenshot-input"
                      disabled={status === "submitting"}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={status === "submitting"}
                      className="w-full p-4 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors flex flex-col items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                        />
                      </svg>
                      <span className="text-sm">Click to upload a screenshot</span>
                    </button>
                  </>
                )}

                {fileError && (
                  <p className="text-sm text-error">{fileError}</p>
                )}
              </div>

              {/* Context Info (collapsed) */}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground transition-colors">
                  Additional context included
                </summary>
                <div className="mt-2 p-2 bg-muted rounded-lg space-y-1 font-mono">
                  <div>Page: {context.pageUrl}</div>
                  <div>Trigger: {context.triggerType}</div>
                  <div>Time: {context.timestamp}</div>
                </div>
              </details>

              {/* Submit Error */}
              {status === "error" && error && (
                <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
                  <p className="text-sm text-error">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleClose}
                  disabled={status === "submitting"}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={status === "submitting"}
                  disabled={status === "submitting"}
                  className="flex-1"
                >
                  Submit Feedback
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
