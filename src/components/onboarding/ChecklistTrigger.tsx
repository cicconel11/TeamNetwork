"use client";

import { useCallback } from "react";

interface ChecklistTriggerProps {
  completedCount: number;
  totalCount: number;
}

/**
 * Sidebar footer button. Dispatches a CustomEvent `tn:open-onboarding`
 * that OnboardingShell listens for to open the checklist panel.
 */
export function ChecklistTrigger({
  completedCount,
  totalCount,
}: ChecklistTriggerProps) {
  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent("tn:open-onboarding"));
  }, []);

  const pct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-muted transition-colors group"
      aria-label={`Getting started — ${completedCount} of ${totalCount} complete`}
    >
      {/* Progress ring */}
      <div className="relative w-5 h-5 flex-shrink-0">
        <svg viewBox="0 0 20 20" className="w-5 h-5 -rotate-90">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-muted"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={`${2 * Math.PI * 8}`}
            strokeDashoffset={`${2 * Math.PI * 8 * (1 - pct / 100)}`}
            className="text-[var(--color-org-secondary)] transition-[stroke-dashoffset] duration-300"
            strokeLinecap="round"
          />
        </svg>
        {pct === 100 && (
          <svg
            className="absolute inset-0 w-5 h-5 text-green-500"
            fill="none"
            viewBox="0 0 20 20"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 10l3 3 5-5"
            />
          </svg>
        )}
      </div>

      {/* Label */}
      <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors truncate">
        Getting started
      </span>

      {/* Badge */}
      {pct < 100 && (
        <span className="ml-auto text-xs font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 shrink-0">
          {completedCount}/{totalCount}
        </span>
      )}
    </button>
  );
}
