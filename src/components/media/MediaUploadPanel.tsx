"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGalleryUpload, type UploadFileEntry } from "@/hooks/useGalleryUpload";
import { DropZone } from "./DropZone";
import { UploadFileCard } from "./UploadFileCard";
import { UploadSummaryBar } from "./UploadSummaryBar";
import type { MediaAlbum } from "./AlbumCard";

interface MediaUploadPanelProps {
  orgId: string;
  open: boolean;
  onClose: () => void;
  availableTags: string[];
  onFileComplete?: (entry: UploadFileEntry, mediaId: string) => void;
  onAlbumCreated?: (album: MediaAlbum) => void;
}

export function MediaUploadPanel({
  orgId,
  open,
  onClose,
  availableTags,
  onFileComplete,
  onAlbumCreated,
}: MediaUploadPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [albumCreated, setAlbumCreated] = useState(false);
  const [albumCreating, setAlbumCreating] = useState(false);
  const [albumError, setAlbumError] = useState<string | null>(null);

  const {
    files,
    stats,
    completedMediaIds,
    pendingAlbumName,
    addFiles,
    removeFile,
    cancelAll,
    retryFile,
    retryAll,
    updateField,
    updateTags,
    setPendingAlbumName,
    clearPendingAlbum,
  } = useGalleryUpload({ orgId, onFileComplete });

  // Combine gallery tags + tags from the current batch for suggestions
  const batchTags = files.flatMap((f) => f.tags);
  const allSuggestions = [...new Set([...availableTags, ...batchTags])].sort();

  // Auto-create album when all files are done and we have a pending album name
  useEffect(() => {
    if (
      !stats.allDone ||
      !pendingAlbumName ||
      completedMediaIds.length === 0 ||
      albumCreated ||
      albumCreating
    ) {
      return;
    }

    const createAlbum = async () => {
      setAlbumCreating(true);
      setAlbumError(null);
      try {
        // 1. Create the album
        const albumRes = await fetch("/api/media/albums", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, name: pendingAlbumName }),
        });
        if (!albumRes.ok) {
          const data = await albumRes.json().catch(() => null);
          throw new Error(data?.error || "Failed to create album");
        }
        const album: MediaAlbum = await albumRes.json();

        // 2. Batch-add all completed media to the album
        const itemsRes = await fetch(`/api/media/albums/${album.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, mediaIds: completedMediaIds }),
        });
        if (!itemsRes.ok) {
          const data = await itemsRes.json().catch(() => null);
          throw new Error(data?.error || "Failed to add items to album");
        }

        setAlbumCreated(true);
        clearPendingAlbum();
        onAlbumCreated?.(album);
      } catch (err) {
        setAlbumError(err instanceof Error ? err.message : "Failed to create album");
      } finally {
        setAlbumCreating(false);
      }
    };

    createAlbum();
  }, [
    stats.allDone,
    pendingAlbumName,
    completedMediaIds,
    albumCreated,
    albumCreating,
    orgId,
    clearPendingAlbum,
    onAlbumCreated,
  ]);

  // Reset album state when panel opens
  useEffect(() => {
    if (open) {
      setAlbumCreated(false);
      setAlbumCreating(false);
      setAlbumError(null);
    }
  }, [open]);

  // Handle folder upload: add files + set pending album name
  const handleFolder = useCallback(
    (folderFiles: File[], folderName: string) => {
      addFiles(folderFiles);
      setPendingAlbumName(folderName);
      setAlbumCreated(false);
    },
    [addFiles, setPendingAlbumName],
  );

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
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {pendingAlbumName !== null && !albumCreated ? "New Album" : "Upload Media"}
            </h2>
            {pendingAlbumName !== null && !albumCreated ? (
              <p className="text-xs text-[var(--color-org-secondary)] mt-0.5 font-medium truncate max-w-[260px]">
                {pendingAlbumName}
              </p>
            ) : stats.total > 0 ? (
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                {stats.done}/{stats.total} complete
              </p>
            ) : null}
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
          <DropZone
            onFiles={addFiles}
            onFolder={handleFolder}
            disabled={stats.isUploading && files.length >= 20}
          />

          {/* Pending album name (from folder upload) */}
          {pendingAlbumName !== null && !albumCreated && (
            <div className="rounded-xl bg-[var(--color-org-secondary)]/8 border border-[var(--color-org-secondary)]/20 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[var(--color-org-secondary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                </svg>
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {albumCreating ? "Creating album…" : "Creating album from folder"}
                </span>
              </div>
              <div>
                <label className="block text-xs text-[var(--muted-foreground)] mb-1">Album name</label>
                <input
                  className="w-full text-base font-medium bg-transparent border-b border-[var(--border)] focus:border-[var(--color-org-secondary)] outline-none pb-1 text-[var(--foreground)] placeholder-[var(--muted-foreground)]"
                  value={pendingAlbumName}
                  onChange={(e) => setPendingAlbumName(e.target.value)}
                  placeholder="Album name"
                  maxLength={200}
                  disabled={albumCreating}
                />
              </div>
              {albumError && (
                <p className="text-xs text-red-600 dark:text-red-400">{albumError}</p>
              )}
              <button
                type="button"
                onClick={clearPendingAlbum}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                disabled={albumCreating}
              >
                Cancel album creation
              </button>
            </div>
          )}

          {/* Album created success */}
          {albumCreated && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Album created!</p>
            </div>
          )}

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
