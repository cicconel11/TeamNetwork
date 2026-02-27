"use client";

import Image from "next/image";
import { ProgressBar } from "@/components/ui";
import { TagInput } from "./TagInput";
import type { UploadFileEntry, FileUploadStatus } from "@/hooks/useGalleryUpload";

interface UploadFileCardProps {
  entry: UploadFileEntry;
  suggestions: string[];
  onUpdateField: (id: string, field: "title" | "description" | "takenAt", value: string) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const statusConfig: Record<FileUploadStatus, { dot: string; label: string }> = {
  queued: { dot: "bg-[var(--muted-foreground)]", label: "Queued" },
  requesting: { dot: "bg-blue-500 animate-pulse", label: "Preparing..." },
  uploading: { dot: "bg-[var(--color-org-secondary)] animate-pulse", label: "Uploading" },
  finalizing: { dot: "bg-[var(--color-org-secondary)] animate-pulse", label: "Finalizing..." },
  done: { dot: "bg-emerald-500", label: "Done" },
  error: { dot: "bg-red-500", label: "Failed" },
};

export function UploadFileCard({
  entry,
  suggestions,
  onUpdateField,
  onUpdateTags,
  onRemove,
  onRetry,
}: UploadFileCardProps) {
  const isEditable = entry.status === "queued";
  const isActive =
    entry.status === "requesting" ||
    entry.status === "uploading" ||
    entry.status === "finalizing";
  const config = statusConfig[entry.status];
  const isVideo = entry.mimeType.startsWith("video/");

  return (
    <div className="flex gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--card)] animate-fade-in">
      {/* Thumbnail */}
      <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-[var(--muted)] shrink-0">
        {entry.previewUrl ? (
          <Image
            src={entry.previewUrl}
            alt=""
            fill
            className="object-cover"
            sizes="48px"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            {isVideo ? (
              <svg className="w-5 h-5 text-[var(--muted-foreground)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-[var(--muted-foreground)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M2.25 18.75h19.5" />
              </svg>
            )}
          </div>
        )}
        {/* Status dot */}
        <div className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ${config.dot}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Top row: filename + size + remove */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted-foreground)] truncate">
              {entry.fileName}{" "}
              <span className="font-mono text-[10px]">{formatFileSize(entry.fileSize)}</span>
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {entry.status === "error" && entry.retryCount < 3 && (
              <button
                type="button"
                onClick={() => onRetry(entry.id)}
                className="text-xs text-[var(--color-org-secondary)] hover:underline font-medium"
              >
                Retry
              </button>
            )}
            {!isActive && (
              <button
                type="button"
                onClick={() => onRemove(entry.id)}
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[var(--muted)] transition-colors"
                aria-label="Remove file"
              >
                <svg className="w-3 h-3 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tags */}
        {isEditable && (
          <div className="text-xs">
            <TagInput
              tags={entry.tags}
              onChange={(tags) => onUpdateTags(entry.id, tags)}
              suggestions={suggestions}
              disabled={!isEditable}
              placeholder="Tags..."
            />
          </div>
        )}

        {/* Date */}
        {isEditable && (
          <input
            type="date"
            value={entry.takenAt}
            onChange={(e) => onUpdateField(entry.id, "takenAt", e.target.value)}
            className="w-full text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ "--tw-ring-color": "var(--color-org-primary)" } as React.CSSProperties}
          />
        )}

        {/* Progress bar */}
        {(isActive || entry.status === "done") && (
          <ProgressBar
            value={entry.progress}
            variant={entry.status === "done" ? "success" : "default"}
            animated={isActive}
            size="sm"
          />
        )}

        {/* Error message */}
        {entry.status === "error" && entry.error && (
          <p className="text-xs text-red-600 dark:text-red-400">{entry.error}</p>
        )}

        {/* Done message */}
        {entry.status === "done" && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Pending review</p>
        )}
      </div>
    </div>
  );
}
