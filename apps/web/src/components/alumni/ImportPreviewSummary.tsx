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
        previewingText
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
