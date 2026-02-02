"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button, Input, Card } from "@/components/ui";

interface OrgPreview {
  id: string;
  name: string;
  slug: string;
  alumniCount: number;
}

interface AdoptOrgDialogProps {
  isOpen: boolean;
  onClose: () => void;
  enterpriseSlug: string;
  onSubmit: (organizationSlug: string) => Promise<void>;
}

export function AdoptOrgDialog({
  isOpen,
  onClose,
  enterpriseSlug,
  onSubmit,
}: AdoptOrgDialogProps) {
  const [orgSlug, setOrgSlug] = useState("");
  const [preview, setPreview] = useState<OrgPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  const resetForm = useCallback(() => {
    setOrgSlug("");
    setPreview(null);
    setIsLoadingPreview(false);
    setIsSubmitting(false);
    setError(null);
    setPreviewError(null);
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

  const handlePreview = async () => {
    if (!orgSlug.trim()) {
      setPreviewError("Please enter an organization slug");
      return;
    }

    setIsLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);

    try {
      const response = await fetch(
        `/api/enterprise/${enterpriseSlug}/adopt/preview?slug=${encodeURIComponent(orgSlug.trim())}`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Organization not found");
      }

      const data = await response.json();
      setPreview(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to fetch organization");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!preview) {
      setError("Please preview the organization first");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(preview.slug);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send adoption request");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="adopt-org-dialog-title"
    >
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id="adopt-org-dialog-title" className="text-lg font-semibold text-foreground">
            Adopt Organization
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
            aria-label="Close modal"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <Input
              label="Organization Slug"
              placeholder="my-organization"
              value={orgSlug}
              onChange={(e) => {
                setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                setPreview(null);
                setPreviewError(null);
              }}
              error={previewError ?? undefined}
              disabled={isSubmitting}
            />
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handlePreview}
                isLoading={isLoadingPreview}
                disabled={isLoadingPreview || isSubmitting || !orgSlug.trim()}
              >
                Preview Organization
              </Button>
            </div>
          </div>

          {preview && (
            <Card padding="sm" className="bg-muted/50">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{preview.name}</span>
                  <span className="text-xs text-muted-foreground">/{preview.slug}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {preview.alumniCount.toLocaleString()} alumni
                </div>
              </div>
            </Card>
          )}

          {/* Warning */}
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm space-y-1">
            <p className="font-medium">What happens when you adopt an organization:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>A request will be sent to the organization admin</li>
              <li>If accepted, billing will transfer to this enterprise</li>
              <li>Alumni counts will be pooled with your enterprise quota</li>
              <li>The organization will retain its settings and data</li>
            </ul>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
              disabled={isSubmitting || !preview}
              className="flex-1"
            >
              Send Request
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
