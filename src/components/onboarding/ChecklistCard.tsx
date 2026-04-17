"use client";

import { useCallback, useState } from "react";
import { Card, Button } from "@/components/ui";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ChecklistItem } from "./ChecklistItem";
import {
  markItemComplete,
  dismissChecklist,
} from "@/lib/onboarding/progress";
import { getVisibleOnboardingItems } from "@/lib/onboarding/visible-items";
import type { OrgRole } from "@/lib/auth/role-utils";
import type { OnboardingItemId } from "@/lib/schemas/onboarding";
import type { OnboardingProgress } from "@/lib/onboarding/progress";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ChecklistCardProps {
  userId: string;
  orgId: string;
  orgSlug: string;
  memberId?: string | null;
  role: OrgRole | null;
  hasAlumniAccess: boolean;
  hasParentsAccess?: boolean;
  initialProgress: OnboardingProgress;
  onDismiss?: () => void;
  /** Fired when the user clicks a checklist item link — lets the shell close the panel. */
  onItemClick?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChecklistCard({
  userId,
  orgId,
  orgSlug,
  memberId,
  role,
  hasAlumniAccess,
  hasParentsAccess = false,
  initialProgress,
  onDismiss,
  onItemClick,
}: ChecklistCardProps) {
  const visibleItems = getVisibleOnboardingItems({
    role,
    hasAlumniAccess,
    hasParentsAccess,
  });

  const [completedItems, setCompletedItems] = useState<OnboardingItemId[]>(
    initialProgress.completedItems
  );
  const [markingDone, setMarkingDone] = useState<OnboardingItemId | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const completedCount = visibleItems.filter((item) =>
    completedItems.includes(item.id)
  ).length;
  const totalCount = visibleItems.length;
  const progressPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleMarkDone = useCallback(
    async (itemId: OnboardingItemId) => {
      if (completedItems.includes(itemId)) return;
      setMarkingDone(itemId);
      try {
        await markItemComplete(userId, orgId, itemId, completedItems);
        setCompletedItems((prev) => [...prev, itemId]);
      } catch (err) {
        console.error("Failed to mark item complete:", err);
      } finally {
        setMarkingDone(null);
      }
    },
    [userId, orgId, completedItems]
  );

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    try {
      await dismissChecklist(userId, orgId);
      onDismiss?.();
    } catch (err) {
      console.error("Failed to dismiss checklist:", err);
    } finally {
      setDismissing(false);
    }
  }, [userId, orgId, onDismiss]);

  return (
    <Card padding="sm" className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Getting started
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {completedCount} of {totalCount} completed
          </p>
        </div>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
          aria-label="Dismiss getting started checklist"
        >
          <svg
            className="w-4 h-4"
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

      {/* Progress bar */}
      <ProgressBar
        value={progressPct}
        variant={progressPct === 100 ? "success" : "default"}
        size="sm"
        label={`${progressPct}% complete`}
        className="mb-3"
      />

      {/* Items */}
      <div className="divide-y divide-border">
        {visibleItems.map((item) => (
          <ChecklistItem
            key={item.id}
            item={item}
            orgSlug={orgSlug}
            memberId={memberId ?? undefined}
            completed={completedItems.includes(item.id)}
            onMarkDone={handleMarkDone}
            isMarkingDone={markingDone === item.id}
            onNavigate={onItemClick}
          />
        ))}
      </div>

      {/* All done state */}
      {progressPct === 100 && (
        <div className="mt-3 text-center">
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">
            🎉 You&apos;re all set! Feel free to dismiss this.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            disabled={dismissing}
            className="mt-1 text-xs"
          >
            Dismiss
          </Button>
        </div>
      )}
    </Card>
  );
}
