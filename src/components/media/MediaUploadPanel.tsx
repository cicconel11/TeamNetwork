"use client";

import { useCallback, useEffect, useRef } from "react";
import { useGalleryUpload, type UploadFileEntry } from "@/hooks/useGalleryUpload";
import { DropZone } from "./DropZone";
import { UploadFileCard } from "./UploadFileCard";
import { UploadSummaryBar } from "./UploadSummaryBar";

interface MediaUploadPanelProps {
  orgId: string;
  open: boolean;
  onClose: () => void;
  availableTags: string[];
  onFileComplete?: (entry: UploadFileEntry, mediaId: string) => void;
}

export function MediaUploadPanel({
  orgId,
  open,
  onClose,
  availableTags,
  onFileComplete,
}: MediaUploadPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const {
    files,
    stats,
    addFiles,
    removeFile,
    cancelAll,
    retryFile,
    retryAll,
    updateField,
    updateTags,
  } = useGalleryUpload({ orgId, onFileComplete });

  // Combine gallery tags + tags from the current batch for suggestions
  const batchTags = files.flatMap((f) => f.tags);
  const allSuggestions = [...new Set([...availableTags, ...batchTags])].sort();

  // Escape to close (only when not uploading)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !stats.isUploading) {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, stats.isUploading, onClose]);

  // Focus trap: return focus on close
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      // Focus the panel
      setTimeout(() => panelRef.current?.focus(), 0);
    } else if (previousFocus.current) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (stats.isUploading) return;
    onClose();
  }, [stats.isUploading, onClose]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden"
          onClick={handleClose}
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Upload media"
        className={`fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] bg-[var(--card)] border-l border-[var(--border)] shadow-xl flex flex-col outline-none transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Upload Media</h2>
            {stats.total > 0 && (
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                {stats.done}/{stats.total} complete
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={stats.isUploading}
            className="w-8 h-8 rounded-full hover:bg-[var(--muted)] flex items-center justify-center transition-colors disabled:opacity-50"
            aria-label="Close upload panel"
          >
            <svg className="w-4 h-4 text-[var(--foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Drop zone */}
          <DropZone onFiles={addFiles} disabled={stats.isUploading && files.length >= 20} />

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-3 stagger-children">
              {files.map((entry) => (
                <UploadFileCard
                  key={entry.id}
                  entry={entry}
                  suggestions={allSuggestions}
                  onUpdateField={updateField}
                  onUpdateTags={updateTags}
                  onRemove={removeFile}
                  onRetry={retryFile}
                />
              ))}
            </div>
          )}
        </div>

        {/* Summary bar */}
        <div className="shrink-0">
          <UploadSummaryBar stats={stats} onRetryAll={retryAll} />
        </div>
      </div>
    </>
  );
}
