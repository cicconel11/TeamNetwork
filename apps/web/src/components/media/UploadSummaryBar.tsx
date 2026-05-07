"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { ProgressBar } from "@/components/ui";

interface UploadStats {
  total: number;
  done: number;
  errored: number;
  active: number;
  overallProgress: number;
  isUploading: boolean;
  allDone: boolean;
}

interface UploadSummaryBarProps {
  stats: UploadStats;
  onRetryAll: () => void;
}

export function UploadSummaryBar({ stats, onRetryAll }: UploadSummaryBarProps) {
  const prevDone = useRef(stats.done);
  const prevErrored = useRef(stats.errored);

  // Toast on individual file completion or failure
  useEffect(() => {
    if (stats.done > prevDone.current) {
      const count = stats.done - prevDone.current;
      if (count === 1) {
        toast.success("File uploaded — pending review");
      } else {
        toast.success(`${count} files uploaded — pending review`);
      }
    }
    if (stats.errored > prevErrored.current) {
      const count = stats.errored - prevErrored.current;
      toast.error(count === 1 ? "Upload failed" : `${count} uploads failed`);
    }
    prevDone.current = stats.done;
    prevErrored.current = stats.errored;
  }, [stats.done, stats.errored]);

  if (stats.total === 0) return null;

  // All finished
  if (stats.allDone) {
    if (stats.errored > 0) {
      return (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--foreground)]">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{stats.done} uploaded</span>
            {stats.errored > 0 && (
              <span className="text-red-600 dark:text-red-400 font-medium">, {stats.errored} failed</span>
            )}
          </p>
          <button
            type="button"
            onClick={onRetryAll}
            className="text-xs font-medium text-[var(--color-org-secondary)] hover:underline"
          >
            Retry failed
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center px-4 py-3 border-t border-[var(--border)]">
        <svg className="w-4 h-4 text-emerald-500 mr-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
          All {stats.done} uploaded
        </p>
      </div>
    );
  }

  // In progress
  return (
    <div className="px-4 py-3 border-t border-[var(--border)] space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted-foreground)]">
          Uploading {stats.done + stats.active}/{stats.total}...
        </p>
        <span className="text-xs font-mono text-[var(--muted-foreground)]">
          {stats.overallProgress}%
        </span>
      </div>
      <ProgressBar value={stats.overallProgress} animated size="sm" />
    </div>
  );
}
