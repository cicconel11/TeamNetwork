"use client";

import type { ImportSummary } from "@/lib/alumni/import-utils";

interface ImportPreviewSummaryProps {
  summary: ImportSummary;
  isPreviewing: boolean;
  previewingText?: string;
}

export function ImportPreviewSummary({
  summary,
  isPreviewing,
  previewingText = "Checking rows against alumni records\u2026",
}: ImportPreviewSummaryProps) {
  return (
    <div className="text-xs text-muted-foreground" aria-live="polite">
      {isPreviewing ? (
        <span className="inline-flex items-center gap-2">
          <svg className="animate-spin h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {previewingText}
        </span>
      ) : (
        <span className="flex items-center gap-3 flex-wrap">
          {summary.willCreate > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              {summary.willCreate} will create
            </span>
          )}
          {summary.willUpdate > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              {summary.willUpdate} will update
            </span>
          )}
          {summary.willSkip > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
              {summary.willSkip} will skip
            </span>
          )}
          {summary.quotaBlocked > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              {summary.quotaBlocked} quota blocked
            </span>
          )}
          {summary.invalid > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              {summary.invalid} invalid
            </span>
          )}
        </span>
      )}
    </div>
  );
}
