"use client";

import Link from "next/link";
import { Button } from "@/components/ui";
import type { OnboardingItem } from "@/lib/onboarding/items";
import type { OnboardingItemId } from "@/lib/schemas/onboarding";

// ─── Inline icons ─────────────────────────────────────────────────────────────

function CheckCircleIcon() {
  return (
    <svg
      className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function EmptyCircleIcon() {
  return (
    <svg
      className="w-5 h-5 text-muted-foreground flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ChecklistItemProps {
  item: OnboardingItem;
  orgSlug: string;
  memberId?: string;
  completed: boolean;
  onMarkDone: (id: OnboardingItemId) => void;
  isMarkingDone: boolean;
  /** Fired when user clicks the item's link — lets parent close the panel. */
  onNavigate?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChecklistItem({
  item,
  orgSlug,
  memberId,
  completed,
  onMarkDone,
  isMarkingDone,
  onNavigate,
}: ChecklistItemProps) {
  const href = item.href(orgSlug, memberId);

  return (
    <div className="flex items-start gap-3 py-2.5 group">
      {/* Check indicator */}
      <div className="mt-0.5">
        {completed ? <CheckCircleIcon /> : <EmptyCircleIcon />}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <Link
          href={href}
          onClick={onNavigate}
          className={`block text-sm font-medium leading-snug hover:underline ${
            completed
              ? "line-through text-muted-foreground"
              : "text-foreground"
          }`}
        >
          {item.title}
        </Link>
        {!completed && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {item.description}
          </p>
        )}
      </div>

      {/* Manual "Mark done" — only shown when not auto-detectable or not yet complete.
          Uses group-focus-within so keyboard users can actually reach it. */}
      {!completed && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onMarkDone(item.id)}
          disabled={isMarkingDone}
          className="text-xs opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity shrink-0"
          aria-label={`Mark ${item.title} as done`}
        >
          Done
        </Button>
      )}
    </div>
  );
}
