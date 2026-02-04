"use client";

import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";

export interface PendingOrgData {
  name: string;
  slug: string;
  primaryColor: string;
}

interface OrgLimitUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  pendingOrgData: PendingOrgData;
  currentCount: number;
  maxAllowed: number;
  isLoading: boolean;
}

export function OrgLimitUpgradeModal({
  isOpen,
  onClose,
  onConfirm,
  pendingOrgData,
  currentCount,
  maxAllowed,
  isLoading,
}: OrgLimitUpgradeModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isLoading) {
        onClose();
      }
    },
    [onClose, isLoading]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onClose();
      }
    },
    [isOpen, onClose, isLoading]
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

  const handleConfirm = async () => {
    await onConfirm();
  };

  if (!isOpen) {
    return null;
  }

  const pricePerYearDollars = ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly / 100;

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
      aria-hidden="false"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
    >
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id="upgrade-modal-title" className="text-lg font-semibold text-foreground">
            Organization Limit Reached
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="p-4 space-y-4">
          {/* Limit warning */}
          <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-amber-600 dark:text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              You&apos;ve reached your organization limit ({currentCount} of {maxAllowed})
            </p>
          </div>

          {/* Pricing info */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              First {ENTERPRISE_SEAT_PRICING.freeSubOrgs} organizations are free. Additional organizations are ${pricePerYearDollars}/year each.
            </p>
          </div>

          {/* Organization being created */}
          <div className="p-3 border border-border rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Creating organization:</p>
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: pendingOrgData.primaryColor }}
              />
              <span className="font-medium text-foreground">{pendingOrgData.name}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirm}
              isLoading={isLoading}
              disabled={isLoading}
              className="flex-1"
            >
              Upgrade & Create Organization
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
