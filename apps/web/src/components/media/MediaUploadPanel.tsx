"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useGalleryUpload, type UploadFileEntry } from "@/hooks/useGalleryUpload";
import { summarizeFolderAlbumBatch } from "@/lib/media/gallery-upload-flow";
import { DropZone } from "./DropZone";
import { UploadFileCard } from "./UploadFileCard";
import { UploadSummaryBar } from "./UploadSummaryBar";
import type { MediaAlbum } from "./AlbumCard";
import { useMediaUploadManager } from "./MediaUploadManagerContext";

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
  const folderUpload = useMediaUploadManager();
  const directUpload = useGalleryUpload({ orgId, targetAlbumId, onFileComplete });

  const isFolderAlbumFlow = !targetAlbumId && folderUpload.hasActiveFolderImport;
  const upload = isFolderAlbumFlow ? folderUpload : directUpload;
  const {
    files,
    stats,
    pendingAlbumName,
    addFiles,
    removeFile,
    retryFile,
    retryAll,
    updateField,
    updateTags,
    setPendingAlbumName,
  } = upload;

  const folderAlbum = folderUpload.folderAlbum;
  const folderAlbumSummary = useMemo(
    () =>
      isFolderAlbumFlow && pendingAlbumName
        ? summarizeFolderAlbumBatch(files, folderAlbum.attachedMediaIds)
        : null,
    [files, folderAlbum.attachedMediaIds, isFolderAlbumFlow, pendingAlbumName],
  );

  const batchTags = files.flatMap((f) => f.tags);
  const allSuggestions = [...new Set([...availableTags, ...batchTags])].sort();

  const handleFolder = useCallback(
    async (folderFiles: File[], folderName: string) => {
      if (targetAlbumId) return;
      const album = await folderUpload.startFolderImport(folderFiles, folderName);
      if (album) {
        onAlbumCreated?.(album);
      }
    },
    [folderUpload, onAlbumCreated, targetAlbumId],
  );

  const handleFiles = useCallback(
    async (newFiles: File[]) => addFiles(newFiles),
    [addFiles],
  );

  const canCloseWhileUploading = isFolderAlbumFlow;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (canCloseWhileUploading || !stats.isUploading)) {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [canCloseWhileUploading, onClose, open, stats.isUploading]);

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
    if (stats.isUploading && !canCloseWhileUploading) return;
    onClose();
  }, [canCloseWhileUploading, onClose, stats.isUploading]);

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
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden"
          onClick={handleClose}
        />
      )}

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Upload media"
        className={`fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] bg-[var(--card)] border-l border-[var(--border)] shadow-xl flex flex-col outline-none transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {targetAlbumName ? "Upload to Album" : isFolderAlbumFlow ? "Album Import" : "Upload Media"}
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
            disabled={stats.isUploading && !canCloseWhileUploading}
            className="w-8 h-8 rounded-full hover:bg-[var(--muted)] flex items-center justify-center transition-colors disabled:opacity-50"
            aria-label="Close upload panel"
          >
            <svg className="w-4 h-4 text-[var(--foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <DropZone
            onFiles={handleFiles}
            onFolder={handleFolder}
            disabled={stats.isUploading && files.length >= 100}
          />

          {isFolderAlbumFlow && (
            <div className="rounded-xl bg-[var(--color-org-secondary)]/8 border border-[var(--color-org-secondary)]/20 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[var(--color-org-secondary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                </svg>
                <span className="text-sm font-semibold text-[var(--foreground)]">{albumStatusLabel}</span>
              </div>
              <div>
                <label className="block text-xs text-[var(--muted-foreground)] mb-1">Album name</label>
                <input
                  className="w-full text-base font-medium bg-transparent border-b border-[var(--border)] focus:border-[var(--color-org-secondary)] outline-none pb-1 text-[var(--foreground)] placeholder-[var(--muted-foreground)]"
                  value={pendingAlbumName ?? ""}
                  onChange={(e) => setPendingAlbumName(e.target.value)}
                  placeholder="Album name"
                  maxLength={200}
                  disabled={isAlbumProcessing}
                />
              </div>
              {folderAlbum.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{folderAlbum.error}</p>
              )}
              {folderAlbumSummary && (
                <p className="text-xs text-[var(--foreground)]">
                  {folderAlbumSummary.completedMediaIds.length} of {files.length} files imported
                  {folderAlbumSummary.failedFileIds.length > 0
                    ? `, ${folderAlbumSummary.failedFileIds.length} still need attention.`
                    : "."}
                </p>
              )}
              {folderAlbum.requiresManualRetry && (
                <button
                  type="button"
                  onClick={folderUpload.retryAlbumProvision}
                  className="text-xs font-medium text-[var(--color-org-secondary)] hover:underline"
                  disabled={isAlbumProcessing}
                >
                  Retry album creation
                </button>
              )}
              <button
                type="button"
                onClick={folderUpload.clearFolderImport}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                disabled={isAlbumProcessing}
              >
                {folderAlbum.album ? "Stop adding to this album" : "Cancel album creation"}
              </button>
              {stats.isUploading && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  You can close this panel or leave the media page while the album keeps importing.
                </p>
              )}
            </div>
          )}

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

        <div className="shrink-0">
          <UploadSummaryBar stats={stats} onRetryAll={retryAll} />
        </div>
      </div>
    </>
  );
}
