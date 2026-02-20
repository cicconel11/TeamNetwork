"use client";

import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { ENTERPRISE_SEAT_PRICING, ALUMNI_BUCKET_PRICING } from "@/types/enterprise";

export interface PendingOrgData {
  name: string;
  slug: string;
  primaryColor: string;
}

type UpgradeType = "sub_org" | "alumni_bucket";

interface BaseUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isLoading: boolean;
}

interface SubOrgUpgradeProps extends BaseUpgradeModalProps {
  upgradeType: "sub_org";
  pendingOrgData: PendingOrgData;
  currentCount: number;
  maxAllowed: number;
}

interface AlumniBucketUpgradeProps extends BaseUpgradeModalProps {
  upgradeType: "alumni_bucket";
  currentBucket: number;
  nextBucketCapacity: number;
  nextBucketPrice: number;
  billingInterval: "month" | "year";
}

type OrgLimitUpgradeModalProps = SubOrgUpgradeProps | AlumniBucketUpgradeProps;

export function OrgLimitUpgradeModal(props: OrgLimitUpgradeModalProps) {
  const { isOpen, onClose, onConfirm, isLoading, upgradeType } = props;
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

  const isSubOrgUpgrade = upgradeType === "sub_org";
  const title = isSubOrgUpgrade ? "Organization Limit Reached" : "Alumni Bucket Upgrade";

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
            {title}
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
          {isSubOrgUpgrade ? (
            <>
              {/* Sub-org limit warning */}
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
                  You&apos;ve reached your organization limit ({props.currentCount} of {props.maxAllowed})
                </p>
              </div>

              {/* Pricing info */}
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  First {ENTERPRISE_SEAT_PRICING.freeSubOrgs} organizations are free. Additional organizations are ${ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly / 100}/year each.
                </p>
              </div>

              {/* Organization being created */}
              <div className="p-3 border border-border rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Creating organization:</p>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: props.pendingOrgData.primaryColor }}
                  />
                  <span className="font-medium text-foreground">{props.pendingOrgData.name}</span>
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
            </>
          ) : (
            <>
              {/* Alumni bucket upgrade info */}
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                <p className="text-sm font-medium text-purple-800 dark:text-purple-200 mb-2">
                  Current Bucket: {props.currentBucket}
                </p>
                <p className="text-xs text-purple-700 dark:text-purple-300">
                  Capacity: {((props.currentBucket - 1) * ALUMNI_BUCKET_PRICING.capacityPerBucket).toLocaleString()} - {(props.currentBucket * ALUMNI_BUCKET_PRICING.capacityPerBucket).toLocaleString()} alumni
                </p>
              </div>

              <div className="flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
              </div>

              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                  Next Bucket: {props.currentBucket + 1}
                </p>
                <p className="text-xs text-green-700 dark:text-green-300">
                  Capacity: {(props.currentBucket * ALUMNI_BUCKET_PRICING.capacityPerBucket).toLocaleString()} - {props.nextBucketCapacity.toLocaleString()} alumni
                </p>
                <p className="text-sm font-semibold text-green-800 dark:text-green-200 mt-2">
                  Price: ${props.nextBucketPrice}/{props.billingInterval === "month" ? "mo" : "yr"}
                </p>
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
                  Confirm Upgrade
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
