/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGalleryUpload, type UploadFileEntry } from "@/hooks/useGalleryUpload";
import {
  getFolderAlbumBatchStatus,
  summarizeFolderAlbumBatch,
  type FolderAlbumBatchStatus,
} from "@/lib/media/gallery-upload-flow";
import { DropZone } from "./DropZone";
import { UploadFileCard } from "./UploadFileCard";
import { UploadSummaryBar } from "./UploadSummaryBar";
import type { MediaAlbum } from "./AlbumCard";

interface MediaUploadPanelProps {
  orgId: string;
  open: boolean;
  onClose: () => void;
  availableTags: string[];
  targetAlbumId?: string;
  targetAlbumName?: string;
  onFileComplete?: (entry: UploadFileEntry, mediaId: string) => void;
  onAlbumCreated?: (album: MediaAlbum) => void;
}

interface FolderAlbumState {
  status: FolderAlbumBatchStatus;
  album: MediaAlbum | null;
  attachedMediaIds: string[];
  error: string | null;
  requiresManualRetry: boolean;
  hasOpenedAlbum: boolean;
}

const INITIAL_FOLDER_ALBUM_STATE: FolderAlbumState = {
  status: "idle",
  album: null,
  attachedMediaIds: [],
  error: null,
  requiresManualRetry: false,
  hasOpenedAlbum: false,
};

export function MediaUploadPanel({
  orgId,
  open,
  onClose,
  availableTags,
  targetAlbumId,
  targetAlbumName,
  onFileComplete,
  onAlbumCreated,
}: MediaUploadPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingFolderSelectionRef = useRef<{ files: File[]; folderName: string } | null>(null);
  const [folderAlbum, setFolderAlbum] = useState<FolderAlbumState>(INITIAL_FOLDER_ALBUM_STATE);

  const effectiveTargetAlbumId = targetAlbumId ?? folderAlbum.album?.id;

  const handleUploadComplete = useCallback((entry: UploadFileEntry, mediaId: string) => {
    setFolderAlbum((prev) => {
      if (!prev.album || prev.attachedMediaIds.includes(mediaId)) {
        return prev;
      }

      return {
        ...prev,
        attachedMediaIds: [...prev.attachedMediaIds, mediaId],
        album: {
          ...prev.album,
          item_count: prev.album.item_count + 1,
          updated_at: new Date().toISOString(),
        },
      };
    });
    onFileComplete?.(entry, mediaId);
  }, [onFileComplete]);

  const {
    files,
    stats,
    pendingAlbumName,
    addFiles,
    removeFile,
    cancelAll,
    retryFile,
    retryAll,
    updateField,
    updateTags,
    setPendingAlbumName,
  } = useGalleryUpload({ orgId, targetAlbumId: effectiveTargetAlbumId, onFileComplete: handleUploadComplete });

  // Combine gallery tags + tags from the current batch for suggestions
  const batchTags = files.flatMap((f) => f.tags);
  const allSuggestions = [...new Set([...availableTags, ...batchTags])].sort();

  const folderAlbumSummary = useMemo(() => (
    pendingAlbumName
      ? summarizeFolderAlbumBatch(files, folderAlbum.attachedMediaIds)
      : null
  ), [files, folderAlbum.attachedMediaIds, pendingAlbumName]);

  const resetFolderAlbum = useCallback(() => {
    setFolderAlbum(INITIAL_FOLDER_ALBUM_STATE);
  }, []);

  const deleteDraftAlbum = useCallback(async (albumId: string) => {
    const response = await fetch(`/api/media/albums/${albumId}?orgId=${encodeURIComponent(orgId)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Failed to delete album");
    }
  }, [orgId]);

  const handleClearPendingAlbum = useCallback(() => {
    const emptyDraftAlbumId =
      folderAlbum.album && folderAlbum.attachedMediaIds.length === 0
        ? folderAlbum.album.id
        : null;

    pendingFolderSelectionRef.current = null;
    cancelAll();
    resetFolderAlbum();

    if (emptyDraftAlbumId) {
      void deleteDraftAlbum(emptyDraftAlbumId).catch(() => {});
    }
  }, [cancelAll, deleteDraftAlbum, folderAlbum.album, folderAlbum.attachedMediaIds.length, resetFolderAlbum]);

  const provisionFolderAlbum = useCallback(async (folderFiles: File[], folderName: string) => {
    pendingFolderSelectionRef.current = { files: folderFiles, folderName };

    const previousEmptyDraftAlbumId =
      folderAlbum.album && folderAlbum.attachedMediaIds.length === 0
        ? folderAlbum.album.id
        : null;

    cancelAll();
    setPendingAlbumName(folderName);
    setFolderAlbum({
      ...INITIAL_FOLDER_ALBUM_STATE,
      status: "creating_album",
    });

    try {
      if (previousEmptyDraftAlbumId) {
        await deleteDraftAlbum(previousEmptyDraftAlbumId);
      }

      const albumRes = await fetch("/api/media/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name: folderName, isUploadDraft: true }),
      });
      if (!albumRes.ok) {
        const data = await albumRes.json().catch(() => null);
        throw new Error(data?.error || "Failed to create album");
      }

      const album: MediaAlbum = await albumRes.json();
      const addResult = addFiles(folderFiles, { replaceExisting: true });
      const acceptedFiles = folderFiles.length - addResult.rejected.length;

      if (acceptedFiles === 0) {
        pendingFolderSelectionRef.current = null;
        await deleteDraftAlbum(album.id);
        setFolderAlbum({
          ...INITIAL_FOLDER_ALBUM_STATE,
          status: "failed",
          error: addResult.rejected[0]?.error || "No valid files were added to the album.",
        });
        return;
      }

      pendingFolderSelectionRef.current = null;
      setFolderAlbum({
        ...INITIAL_FOLDER_ALBUM_STATE,
        status: "waiting_for_uploads",
        album,
      });
    } catch (err) {
      setFolderAlbum({
        ...INITIAL_FOLDER_ALBUM_STATE,
        status: "failed",
        error: err instanceof Error ? err.message : "Failed to create album",
        requiresManualRetry: true,
      });
    }
  }, [
    addFiles,
    deleteDraftAlbum,
    folderAlbum.album,
    folderAlbum.attachedMediaIds.length,
    orgId,
    cancelAll,
    setPendingAlbumName,
  ]);

  useEffect(() => {
    if (!pendingAlbumName || !folderAlbumSummary || targetAlbumId) return;
    if (folderAlbum.requiresManualRetry) return;

    const nextStatus = getFolderAlbumBatchStatus(folderAlbumSummary, folderAlbum.album?.id ?? null);

    setFolderAlbum((prev) => {
      if (!folderAlbumSummary.hasSuccessfulUploads && folderAlbumSummary.allSettled) {
        const nextError = prev.error ?? "No files uploaded successfully. Retry failed files to create the album.";
        if (prev.status === "failed" && prev.error === nextError) {
          return prev;
        }
        return {
          ...prev,
          status: "failed",
          error: nextError,
        };
      }

      if ((nextStatus === "success" || nextStatus === "partial_success") && prev.album) {
        return {
          ...prev,
          status: nextStatus,
          error: null,
        };
      }

      if (prev.status === nextStatus && prev.error === null) {
        return prev;
      }

      return {
        ...prev,
        status: nextStatus,
        error: nextStatus === "success" || nextStatus === "partial_success" ? null : prev.error,
      };
    });
  }, [
    pendingAlbumName,
    folderAlbumSummary,
    folderAlbum.status,
    folderAlbum.album,
    targetAlbumId,
    folderAlbum.requiresManualRetry,
  ]);

  useEffect(() => {
    if (!folderAlbum.album || folderAlbum.hasOpenedAlbum) return;
    if (folderAlbum.status !== "success" && folderAlbum.status !== "partial_success") return;

    onAlbumCreated?.(folderAlbum.album);
    setFolderAlbum((prev) => (prev.hasOpenedAlbum ? prev : { ...prev, hasOpenedAlbum: true }));
  }, [folderAlbum.album, folderAlbum.hasOpenedAlbum, folderAlbum.status, onAlbumCreated]);

  useEffect(() => {
    if (pendingAlbumName !== null || files.length > 0) return;
    if (folderAlbum.status === "idle") return;
    resetFolderAlbum();
  }, [files.length, folderAlbum.status, pendingAlbumName, resetFolderAlbum]);

  // Handle folder upload: add files + set pending album name (unless targeting an album)
  const handleFolder = useCallback(
    (folderFiles: File[], folderName: string) => {
      if (targetAlbumId) return;
      void provisionFolderAlbum(folderFiles, folderName);
    },
    [provisionFolderAlbum, targetAlbumId],
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

  useEffect(() => {
    if (targetAlbumId || !folderAlbum.album || !pendingAlbumName) return;

    const nextName = pendingAlbumName.trim();
    if (!nextName || nextName === folderAlbum.album.name) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/media/albums/${folderAlbum.album?.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgId, name: nextName }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || "Failed to update album");
          }

          const updatedAlbum = await response.json();
          setFolderAlbum((prev) => {
            if (!prev.album || prev.album.id !== updatedAlbum.id) {
              return prev;
            }
            return {
              ...prev,
              album: {
                ...prev.album,
                name: updatedAlbum.name,
                updated_at: updatedAlbum.updated_at,
              },
              error: prev.error === "Failed to update album" ? null : prev.error,
            };
          });
        } catch (err) {
          setFolderAlbum((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Failed to update album",
          }));
        }
      })();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [folderAlbum.album, orgId, pendingAlbumName, targetAlbumId]);

  const retryAlbumProvision = useCallback(() => {
    if (!pendingFolderSelectionRef.current) return;
    void provisionFolderAlbum(
      pendingFolderSelectionRef.current.files,
      pendingFolderSelectionRef.current.folderName,
    );
  }, [provisionFolderAlbum]);

  const isFolderAlbumFlow = !targetAlbumId && pendingAlbumName !== null;
  const isAlbumProcessing = folderAlbum.status === "creating_album";
  const showAlbumSuccess = folderAlbum.status === "success" || folderAlbum.status === "partial_success";
  const albumStatusLabel = isAlbumProcessing
    ? "Creating album..."
    : showAlbumSuccess
      ? folderAlbum.status === "partial_success"
        ? "Album created with partial success"
        : "Album created!"
      : "Uploading folder to album";

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
              {targetAlbumName ? "Upload to Album" : isFolderAlbumFlow ? "New Album" : "Upload Media"}
            </h2>
            {targetAlbumName ? (
              <p className="text-xs text-[var(--color-org-secondary)] mt-0.5 font-medium truncate max-w-[260px]">
                {targetAlbumName}
              </p>
            ) : isFolderAlbumFlow ? (
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
            disabled={stats.isUploading && files.length >= 100}
          />

          {/* Pending album name (from folder upload) */}
          {isFolderAlbumFlow && (
            <div className="rounded-xl bg-[var(--color-org-secondary)]/8 border border-[var(--color-org-secondary)]/20 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[var(--color-org-secondary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                </svg>
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {albumStatusLabel}
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
                  disabled={isAlbumProcessing}
                />
              </div>
              {folderAlbum.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{folderAlbum.error}</p>
              )}
              {folderAlbum.status === "partial_success" && folderAlbumSummary && (
                <p className="text-xs text-[var(--foreground)]">
                  {folderAlbumSummary.completedMediaIds.length} uploaded to the album, {folderAlbumSummary.failedFileIds.length} still need attention.
                </p>
              )}
              {folderAlbum.requiresManualRetry && (
                <button
                  type="button"
                  onClick={retryAlbumProvision}
                  className="text-xs font-medium text-[var(--color-org-secondary)] hover:underline"
                  disabled={isAlbumProcessing}
                >
                  Retry album creation
                </button>
              )}
              <button
                type="button"
                onClick={handleClearPendingAlbum}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                disabled={isAlbumProcessing}
              >
                {folderAlbum.album ? "Stop adding to this album" : "Cancel album creation"}
              </button>
            </div>
          )}

          {/* Album created success */}
          {showAlbumSuccess && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {folderAlbum.status === "partial_success" ? "Album created. Retry failed files to finish the folder." : "Album created!"}
              </p>
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
