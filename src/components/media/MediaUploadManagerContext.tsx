"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useGalleryUpload, type UploadFileEntry } from "@/hooks/useGalleryUpload";
import {
  getFolderAlbumBatchStatus,
  summarizeFolderAlbumBatch,
  type FolderAlbumBatchStatus,
} from "@/lib/media/gallery-upload-flow";
import {
  buildFolderImportAlbum,
  isFolderImportSessionActive,
} from "@/lib/media/folder-import-session";
import type { MediaAlbum } from "./AlbumCard";

interface FolderAlbumState {
  status: FolderAlbumBatchStatus;
  album: MediaAlbum | null;
  attachedMediaIds: string[];
  error: string | null;
  requiresManualRetry: boolean;
}

const INITIAL_FOLDER_ALBUM_STATE: FolderAlbumState = {
  status: "idle",
  album: null,
  attachedMediaIds: [],
  error: null,
  requiresManualRetry: false,
};

interface MediaUploadManagerContextValue {
  files: UploadFileEntry[];
  stats: ReturnType<typeof useGalleryUpload>["stats"];
  pendingAlbumName: string | null;
  folderAlbum: FolderAlbumState;
  importingAlbum: MediaAlbum | null;
  hasActiveFolderImport: boolean;
  addFiles: ReturnType<typeof useGalleryUpload>["addFiles"];
  removeFile: ReturnType<typeof useGalleryUpload>["removeFile"];
  retryFile: ReturnType<typeof useGalleryUpload>["retryFile"];
  retryAll: ReturnType<typeof useGalleryUpload>["retryAll"];
  updateField: ReturnType<typeof useGalleryUpload>["updateField"];
  updateTags: ReturnType<typeof useGalleryUpload>["updateTags"];
  setPendingAlbumName: ReturnType<typeof useGalleryUpload>["setPendingAlbumName"];
  clearPendingAlbum: ReturnType<typeof useGalleryUpload>["clearPendingAlbum"];
  clearFolderImport: () => void;
  retryAlbumProvision: () => void;
  startFolderImport: (folderFiles: File[], folderName: string) => Promise<MediaAlbum | null>;
}

const MediaUploadManagerContext = createContext<MediaUploadManagerContextValue | null>(null);

export function MediaUploadManagerProvider({
  orgId,
  children,
}: {
  orgId: string;
  children: ReactNode;
}) {
  const pendingFolderSelectionRef = useRef<{ files: File[]; folderName: string } | null>(null);
  const [folderAlbum, setFolderAlbum] = useState<FolderAlbumState>(INITIAL_FOLDER_ALBUM_STATE);

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
  }, []);

  const upload = useGalleryUpload({
    orgId,
    targetAlbumId: folderAlbum.album?.id,
    onFileComplete: handleUploadComplete,
  });

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
    clearPendingAlbum,
  } = upload;

  const folderAlbumSummary = useMemo(
    () =>
      pendingAlbumName
        ? summarizeFolderAlbumBatch(files, folderAlbum.attachedMediaIds)
        : null,
    [files, folderAlbum.attachedMediaIds, pendingAlbumName],
  );

  const importingAlbum = useMemo(
    () => buildFolderImportAlbum(folderAlbum.album, files, folderAlbum.attachedMediaIds),
    [files, folderAlbum.album, folderAlbum.attachedMediaIds],
  );

  const hasActiveFolderImport = isFolderImportSessionActive(
    pendingAlbumName,
    files,
    folderAlbum.album?.id ?? null,
  );

  const resetFolderAlbum = useCallback(() => {
    setFolderAlbum(INITIAL_FOLDER_ALBUM_STATE);
  }, []);

  const deleteDraftAlbum = useCallback(
    async (albumId: string) => {
      const response = await fetch(`/api/media/albums/${albumId}?orgId=${encodeURIComponent(orgId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete album");
      }
    },
    [orgId],
  );

  const clearFolderImport = useCallback(() => {
    const emptyDraftAlbumId =
      folderAlbum.album && folderAlbum.attachedMediaIds.length === 0
        ? folderAlbum.album.id
        : null;

    pendingFolderSelectionRef.current = null;
    cancelAll();
    clearPendingAlbum();
    resetFolderAlbum();

    if (emptyDraftAlbumId) {
      void deleteDraftAlbum(emptyDraftAlbumId).catch(() => {});
    }
  }, [
    cancelAll,
    clearPendingAlbum,
    deleteDraftAlbum,
    folderAlbum.album,
    folderAlbum.attachedMediaIds.length,
    resetFolderAlbum,
  ]);

  const startFolderImport = useCallback(
    async (folderFiles: File[], folderName: string) => {
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
          clearPendingAlbum();
          return null;
        }

        pendingFolderSelectionRef.current = null;
        setFolderAlbum({
          ...INITIAL_FOLDER_ALBUM_STATE,
          status: "waiting_for_uploads",
          album,
        });
        return album;
      } catch (err) {
        setFolderAlbum({
          ...INITIAL_FOLDER_ALBUM_STATE,
          status: "failed",
          error: err instanceof Error ? err.message : "Failed to create album",
          requiresManualRetry: true,
        });
        return null;
      }
    },
    [
      addFiles,
      cancelAll,
      clearPendingAlbum,
      deleteDraftAlbum,
      folderAlbum.album,
      folderAlbum.attachedMediaIds.length,
      orgId,
      setPendingAlbumName,
    ],
  );

  useEffect(() => {
    if (!pendingAlbumName || !folderAlbumSummary) return;
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
    folderAlbum.album,
    folderAlbum.requiresManualRetry,
    folderAlbumSummary,
    pendingAlbumName,
  ]);

  useEffect(() => {
    if (!folderAlbum.album || !pendingAlbumName) return;

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
  }, [folderAlbum.album, orgId, pendingAlbumName]);

  useEffect(() => {
    if (pendingAlbumName !== null || files.length > 0) return;
    if (folderAlbum.status === "idle") return;
    resetFolderAlbum();
  }, [files.length, folderAlbum.status, pendingAlbumName, resetFolderAlbum]);

  const retryAlbumProvision = useCallback(() => {
    if (!pendingFolderSelectionRef.current) return;
    void startFolderImport(
      pendingFolderSelectionRef.current.files,
      pendingFolderSelectionRef.current.folderName,
    );
  }, [startFolderImport]);

  const value = useMemo<MediaUploadManagerContextValue>(
    () => ({
      files,
      stats,
      pendingAlbumName,
      folderAlbum,
      importingAlbum,
      hasActiveFolderImport,
      addFiles,
      removeFile,
      retryFile,
      retryAll,
      updateField,
      updateTags,
      setPendingAlbumName,
      clearPendingAlbum,
      clearFolderImport,
      retryAlbumProvision,
      startFolderImport,
    }),
    [
      addFiles,
      clearFolderImport,
      clearPendingAlbum,
      files,
      folderAlbum,
      hasActiveFolderImport,
      importingAlbum,
      pendingAlbumName,
      removeFile,
      retryAlbumProvision,
      retryAll,
      retryFile,
      setPendingAlbumName,
      startFolderImport,
      stats,
      updateField,
      updateTags,
    ],
  );

  return (
    <MediaUploadManagerContext.Provider value={value}>
      {children}
    </MediaUploadManagerContext.Provider>
  );
}

export function useMediaUploadManager() {
  const context = useContext(MediaUploadManagerContext);
  if (!context) {
    throw new Error("useMediaUploadManager must be used within MediaUploadManagerProvider");
  }
  return context;
}
