"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  validateGalleryRawFile,
  validateGalleryPreparedSize,
  deriveDefaultTitle,
  detectDuplicate,
  resolveGalleryMimeType,
  checkBatchLimit,
} from "@/lib/media/gallery-validation";
import {
  getGalleryRetryProgress,
  getGalleryUploadMode,
} from "@/lib/media/gallery-upload-flow";
import {
  prepareImageUpload,
  type PreparedImageUpload,
} from "@/lib/media/image-preparation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileUploadStatus =
  | "queued"
  | "requesting"
  | "uploading"
  | "finalizing"
  | "associating"
  | "done"
  | "error";

export interface UploadFileEntry {
  id: string;
  file: File | null; // nulled after upload completes to free memory
  previewFile: File | null;
  fileName: string;
  fileSize: number;
  previewFileSize: number;
  mimeType: string;
  previewMimeType: string | null;
  previewUrl: string | null;
  title: string;
  description: string;
  tags: string[];
  takenAt: string;
  status: FileUploadStatus;
  progress: number; // 0-100
  error: string | null;
  retryCount: number;
  mediaId: string | null; // from upload intent response
  uploadFinalized: boolean;
  /**
   * The user's original file name and size, captured before
   * `prepareImageUpload` rewrites `.jpeg` → `.jpg` and shrinks the byte
   * count. Used as the dedupe key across `addFiles` calls so that re-picking
   * the same source file is detected even after normalization.
   */
  originalName: string;
  originalSize: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: "ADD_FILES"; entries: UploadFileEntry[]; replaceExisting?: boolean }
  | { type: "UPDATE_FIELD"; id: string; field: "title" | "description" | "takenAt"; value: string }
  | { type: "UPDATE_TAGS"; id: string; tags: string[] }
  | { type: "SET_STATUS"; id: string; status: FileUploadStatus; error?: string }
  | { type: "SET_PROGRESS"; id: string; progress: number }
  | { type: "SET_MEDIA_ID"; id: string; mediaId: string }
  | { type: "MARK_FINALIZED"; id: string }
  | { type: "MARK_DONE"; id: string; mediaId: string }
  | { type: "REMOVE_FILE"; id: string }
  | { type: "CLEAR_ALL" }
  | { type: "SET_ALBUM_NAME"; name: string }
  | { type: "CLEAR_ALBUM" };

interface State {
  files: UploadFileEntry[];
  completedMediaIds: string[];
  pendingAlbumName: string | null;
}

export function galleryUploadReducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_FILES":
      return action.replaceExisting
        ? { ...state, files: action.entries, completedMediaIds: [] }
        : { ...state, files: [...state.files, ...action.entries] };

    case "UPDATE_FIELD":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id ? { ...f, [action.field]: action.value } : f,
        ),
      };

    case "UPDATE_TAGS":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id ? { ...f, tags: action.tags } : f,
        ),
      };

    case "SET_STATUS":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id
            ? {
                ...f,
                status: action.status,
                error: action.error ?? f.error,
                retryCount: action.status === "error" ? f.retryCount + 1 : f.retryCount,
              }
            : f,
        ),
      };

    case "SET_PROGRESS":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id ? { ...f, progress: action.progress } : f,
        ),
      };

    case "SET_MEDIA_ID":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id ? { ...f, mediaId: action.mediaId } : f,
        ),
      };

    case "MARK_FINALIZED":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id ? { ...f, uploadFinalized: true } : f,
        ),
      };

    case "MARK_DONE":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id
            ? {
                ...f,
                status: "done",
                progress: 100,
                file: null,
                error: null,
                uploadFinalized: true,
              }
            : f,
        ),
        completedMediaIds: [...state.completedMediaIds, action.mediaId],
      };

    case "REMOVE_FILE":
      return { ...state, files: state.files.filter((f) => f.id !== action.id) };

    case "CLEAR_ALL":
      return { files: [], completedMediaIds: [], pendingAlbumName: null };

    case "SET_ALBUM_NAME":
      return { ...state, pendingAlbumName: action.name };

    case "CLEAR_ALBUM":
      return { ...state, pendingAlbumName: null, completedMediaIds: [] };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 4;
const STAGGER_MS = 500;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Pure helper: prepare a batch of files for upload
// ---------------------------------------------------------------------------

export interface PrepareGalleryUploadInput {
  files: File[];
  /** Raw `{name, size}` pairs of files already in the queue (for dedupe). */
  existingEntries: { name: string; size: number }[];
  /** Injectable for tests; defaults to the real `prepareImageUpload`. */
  prepareImage?: (file: File) => Promise<PreparedImageUpload>;
  /** Injectable for tests; defaults to `crypto.randomUUID`. */
  generateId?: () => string;
  /** Injectable for tests; defaults to `URL.createObjectURL`. */
  createObjectUrl?: (file: File | Blob) => string;
  /** Injectable for tests; defaults to `URL.revokeObjectURL`. */
  revokeObjectUrl?: (url: string) => void;
}

export interface PrepareGalleryUploadResult {
  entries: UploadFileEntry[];
  rejected: { name: string; error: string }[];
}

/**
 * Pure async helper that walks a batch of user-selected files, runs raw
 * validation → dedupe → prep → prepared-size validation, and returns the
 * accepted `UploadFileEntry`s plus any rejections.
 *
 * Extracted from `addFiles` so it can be unit-tested without rendering the
 * hook. The hook is a thin wrapper that wires this helper into React state.
 *
 * Validation order is load-bearing: image size MUST be checked AFTER prep so
 * that a 14 MB iPhone JPEG (which compresses to ~600 KB) is not rejected on
 * its raw byte count.
 */
export async function prepareGalleryUploadEntries(
  input: PrepareGalleryUploadInput,
): Promise<PrepareGalleryUploadResult> {
  const {
    files,
    existingEntries: initialExisting,
    prepareImage = prepareImageUpload,
    generateId = () => crypto.randomUUID(),
    createObjectUrl = (file) => URL.createObjectURL(file),
    revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  } = input;

  const existing = [...initialExisting];
  const entries: UploadFileEntry[] = [];
  const rejected: { name: string; error: string }[] = [];

  for (const file of files) {
    const rawCheck = validateGalleryRawFile(file);
    if (!rawCheck.valid) {
      rejected.push({ name: file.name, error: rawCheck.error! });
      continue;
    }

    if (detectDuplicate(file, existing)) {
      rejected.push({ name: file.name, error: "File already in queue." });
      continue;
    }

    const mimeType = resolveGalleryMimeType(file);
    let uploadFile: File = file;
    let previewFile: File | null = null;
    let previewUrl: string | null = createObjectUrl(file);
    let previewMimeType: string | null = null;
    let fileSize = file.size;
    let previewFileSize = 0;

    if (mimeType.startsWith("image/")) {
      try {
        const prepared = await prepareImage(file);
        uploadFile = prepared.file;
        previewFile = prepared.previewFile;
        previewMimeType = prepared.previewMimeType;
        fileSize = prepared.file.size;
        previewFileSize = prepared.previewFile?.size ?? 0;
        if (previewUrl) revokeObjectUrl(previewUrl);
        previewUrl = prepared.previewUrl;
        console.log("[media/upload] prepared gallery image", {
          fileName: file.name,
          originalBytes: prepared.originalBytes,
          normalizedBytes: prepared.normalizedBytes,
        });
      } catch (error) {
        if (previewUrl) revokeObjectUrl(previewUrl);
        rejected.push({
          name: file.name,
          error: error instanceof Error ? error.message : "Failed to prepare image upload.",
        });
        continue;
      }
    }

    // Now that we know the post-prep byte count, enforce the image size cap.
    const sizeCheck = validateGalleryPreparedSize(fileSize, uploadFile.type || mimeType);
    if (!sizeCheck.valid) {
      if (previewUrl) revokeObjectUrl(previewUrl);
      rejected.push({ name: file.name, error: sizeCheck.error! });
      continue;
    }

    const entry: UploadFileEntry = {
      id: generateId(),
      file: uploadFile,
      previewFile,
      fileName: uploadFile.name,
      fileSize,
      previewFileSize,
      mimeType: uploadFile.type || mimeType,
      previewMimeType,
      previewUrl,
      title: deriveDefaultTitle(file.name),
      description: "",
      tags: [],
      takenAt: "",
      status: "queued",
      progress: 0,
      error: null,
      retryCount: 0,
      mediaId: null,
      uploadFinalized: false,
      originalName: file.name,
      originalSize: file.size,
    };

    entries.push(entry);
    // Subsequent files in the same batch dedupe against the raw original.
    existing.push({ name: file.name, size: file.size });
  }

  return { entries, rejected };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseGalleryUploadOptions {
  orgId: string;
  targetAlbumId?: string;
  onFileComplete?: (entry: UploadFileEntry, mediaId: string) => void;
}

export function useGalleryUpload({ orgId, targetAlbumId, onFileComplete }: UseGalleryUploadOptions) {
  const [state, dispatch] = useReducer(galleryUploadReducer, {
    files: [],
    completedMediaIds: [],
    pendingAlbumName: null,
  });
  const xhrRefs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const processingRef = useRef<Set<string>>(new Set());
  const lastDispatchTime = useRef(0);
  const onFileCompleteRef = useRef(onFileComplete);
  onFileCompleteRef.current = onFileComplete;

  const resetQueue = useCallback((entries: UploadFileEntry[] = []) => {
    xhrRefs.current.forEach((xhr) => xhr.abort());
    xhrRefs.current.clear();

    state.files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });

    processingRef.current.clear();

    if (entries.length > 0) {
      dispatch({ type: "ADD_FILES", entries, replaceExisting: true });
      return;
    }

    dispatch({ type: "CLEAR_ALL" });
  }, [state.files]);

  // ------- Add files -------
  const addFiles = useCallback(
    async (newFiles: File[], options?: { replaceExisting?: boolean }) => {
      const batchCheck = checkBatchLimit(newFiles.length);
      if (!batchCheck.valid) {
        return { rejected: newFiles.map((f) => ({ name: f.name, error: batchCheck.error! })) };
      }

      // Dedupe against raw original name/size — NOT post-prep `fileName`,
      // which gets `.jpeg` rewritten to `.jpg` and trips false negatives.
      const existingEntries = (options?.replaceExisting ? [] : state.files).map((f) => ({
        name: f.originalName,
        size: f.originalSize,
      }));

      const { entries, rejected } = await prepareGalleryUploadEntries({
        files: newFiles,
        existingEntries,
      });

      if (entries.length > 0) {
        if (options?.replaceExisting) {
          resetQueue(entries);
        } else {
          dispatch({ type: "ADD_FILES", entries });
        }
      }

      return { rejected };
    },
    [resetQueue, state.files],
  );

  // ------- Set pending album name (from folder upload) -------
  const setPendingAlbumName = useCallback((name: string) => {
    dispatch({ type: "SET_ALBUM_NAME", name });
  }, []);

  const clearPendingAlbum = useCallback(() => {
    dispatch({ type: "CLEAR_ALBUM" });
  }, []);

  // ------- Process a single file -------
  const processFile = useCallback(
    async (entry: UploadFileEntry) => {
      const mode = getGalleryUploadMode({
        mediaId: entry.mediaId,
        targetAlbumId,
        uploadFinalized: entry.uploadFinalized,
      });

      if (mode === "upload" && !entry.file) return;

      const associateWithAlbum = async (mediaId: string) => {
        if (!targetAlbumId) return;

        dispatch({ type: "SET_STATUS", id: entry.id, status: "associating" });

        const albumRes = await fetch(`/api/media/albums/${targetAlbumId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, mediaIds: [mediaId] }),
        });

        if (!albumRes.ok) {
          const data = await albumRes.json().catch(() => null);
          throw new Error(data?.error || "Failed to add upload to album");
        }
      };

      if (mode === "associate-only" && entry.mediaId) {
        try {
          await associateWithAlbum(entry.mediaId);
          dispatch({ type: "MARK_DONE", id: entry.id, mediaId: entry.mediaId });
          onFileCompleteRef.current?.(entry, entry.mediaId);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          dispatch({
            type: "SET_STATUS",
            id: entry.id,
            status: "error",
            error: message,
          });
        } finally {
          processingRef.current.delete(entry.id);
        }
        return;
      }

      dispatch({ type: "SET_STATUS", id: entry.id, status: "requesting" });

      try {
        const tags = entry.tags.length > 0 ? entry.tags : undefined;
        const intentRes = await fetch("/api/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            fileName: entry.fileName,
            mimeType: entry.mimeType,
            fileSizeBytes: entry.fileSize,
            previewMimeType: entry.previewMimeType ?? undefined,
            previewFileSizeBytes: entry.previewFileSize || undefined,
            title: entry.title.trim() || deriveDefaultTitle(entry.fileName),
            description: entry.description.trim() || undefined,
            tags,
            takenAt: entry.takenAt ? new Date(entry.takenAt).toISOString() : undefined,
          }),
        });

        if (!intentRes.ok) {
          const data = await intentRes.json().catch(() => null);
          throw new Error(data?.error || "Failed to initiate upload");
        }

        const { mediaId, signedUrl, token, previewSignedUrl } = await intentRes.json();
        dispatch({ type: "SET_MEDIA_ID", id: entry.id, mediaId });

        dispatch({ type: "SET_STATUS", id: entry.id, status: "uploading" });

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRefs.current.set(entry.id, xhr);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              dispatch({ type: "SET_PROGRESS", id: entry.id, progress: pct });
            }
          };

          xhr.onload = () => {
            xhrRefs.current.delete(entry.id);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error("File upload failed"));
            }
          };

          xhr.onerror = () => {
            xhrRefs.current.delete(entry.id);
            reject(new Error("Network error during upload"));
          };

          xhr.onabort = () => {
            xhrRefs.current.delete(entry.id);
            reject(new Error("Upload cancelled"));
          };

          xhr.open("PUT", signedUrl);
          xhr.setRequestHeader("Content-Type", entry.mimeType);
          if (token) xhr.setRequestHeader("x-upsert", "true");
          xhr.send(entry.file);
        });

        if (previewSignedUrl && entry.previewFile) {
          const previewUploadRes = await fetch(previewSignedUrl, {
            method: "PUT",
            headers: { "Content-Type": entry.previewFile.type },
            body: entry.previewFile,
          });

          if (!previewUploadRes.ok) {
            throw new Error("Preview upload failed");
          }
        }

        dispatch({ type: "SET_STATUS", id: entry.id, status: "finalizing" });
        dispatch({ type: "SET_PROGRESS", id: entry.id, progress: 100 });

        const finalizeRes = await fetch(`/api/media/${mediaId}/finalize`, {
          method: "POST",
        });

        if (!finalizeRes.ok) {
          const data = await finalizeRes.json().catch(() => null);
          throw new Error(data?.error || "Failed to finalize upload");
        }

        dispatch({ type: "MARK_FINALIZED", id: entry.id });

        if (targetAlbumId) {
          await associateWithAlbum(mediaId);
        }

        dispatch({ type: "MARK_DONE", id: entry.id, mediaId });
        onFileCompleteRef.current?.(entry, mediaId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        if (message === "Upload cancelled") {
          return;
        }
        dispatch({
          type: "SET_STATUS",
          id: entry.id,
          status: "error",
          error: message,
        });
      } finally {
        processingRef.current.delete(entry.id);
      }
    },
    [orgId, targetAlbumId],
  );

  // ------- Concurrency dispatcher -------
  useEffect(() => {
    const activeCount = state.files.filter(
      (f) =>
        f.status === "requesting" ||
        f.status === "uploading" ||
        f.status === "finalizing" ||
        f.status === "associating",
    ).length;

    if (activeCount >= MAX_CONCURRENT) return;

    const nextQueued = state.files.find(
      (f) => f.status === "queued" && !processingRef.current.has(f.id),
    );

    if (!nextQueued) return;

    const now = Date.now();
    const elapsed = now - lastDispatchTime.current;
    const delay = elapsed >= STAGGER_MS ? 0 : STAGGER_MS - elapsed;

    const timer = setTimeout(() => {
      if (processingRef.current.has(nextQueued.id)) return;
      processingRef.current.add(nextQueued.id);
      lastDispatchTime.current = Date.now();
      processFile(nextQueued);
    }, delay);

    return () => clearTimeout(timer);
  }, [state.files, processFile]);

  // ------- Retry -------
  const retryFile = useCallback(
    (id: string) => {
      const entry = state.files.find((f) => f.id === id);
      if (!entry || entry.status !== "error") return;
      if (entry.retryCount >= MAX_RETRIES) return;

      dispatch({
        type: "SET_STATUS",
        id,
        status: "queued",
        error: undefined,
      });
      dispatch({
        type: "SET_PROGRESS",
        id,
        progress: getGalleryRetryProgress(entry.uploadFinalized),
      });
    },
    [state.files],
  );

  const retryAll = useCallback(() => {
    state.files
      .filter((f) => f.status === "error" && f.retryCount < MAX_RETRIES)
      .forEach((f) => retryFile(f.id));
  }, [state.files, retryFile]);

  // ------- Remove / Cancel -------
  const removeFile = useCallback(
    (id: string) => {
      const xhr = xhrRefs.current.get(id);
      if (xhr) xhr.abort();

      const entry = state.files.find((f) => f.id === id);
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);

      processingRef.current.delete(id);
      dispatch({ type: "REMOVE_FILE", id });
    },
    [state.files],
  );

  const cancelAll = useCallback(() => {
    resetQueue();
  }, [resetQueue]);

  // ------- Field updates -------
  const updateField = useCallback(
    (id: string, field: "title" | "description" | "takenAt", value: string) => {
      dispatch({ type: "UPDATE_FIELD", id, field, value });
    },
    [],
  );

  const updateTags = useCallback((id: string, tags: string[]) => {
    dispatch({ type: "UPDATE_TAGS", id, tags });
  }, []);

  // ------- beforeunload -------
  useEffect(() => {
    const hasActive = state.files.some(
      (f) =>
        f.status === "requesting" ||
        f.status === "uploading" ||
        f.status === "finalizing" ||
        f.status === "associating",
    );

    if (!hasActive) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.files]);

  // ------- Cleanup preview URLs on unmount -------
  useEffect(() => {
    const xhrMap = xhrRefs.current;
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      state.files.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
      xhrMap.forEach((xhr) => xhr.abort());
    };
    // We intentionally only run this on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- Derived stats -------
  const stats = {
    total: state.files.length,
    queued: state.files.filter((f) => f.status === "queued").length,
    active: state.files.filter(
      (f) =>
        f.status === "requesting" ||
        f.status === "uploading" ||
        f.status === "finalizing" ||
        f.status === "associating",
    ).length,
    done: state.files.filter((f) => f.status === "done").length,
    errored: state.files.filter((f) => f.status === "error").length,
    overallProgress:
      state.files.length > 0
        ? Math.round(
            state.files.reduce((sum, f) => sum + f.progress, 0) / state.files.length,
          )
        : 0,
    isUploading: state.files.some(
      (f) =>
        f.status === "requesting" ||
        f.status === "uploading" ||
        f.status === "finalizing" ||
        f.status === "associating",
    ),
    allDone:
      state.files.length > 0 &&
      state.files.every((f) => f.status === "done" || f.status === "error"),
  };

  return {
    files: state.files,
    stats,
    completedMediaIds: state.completedMediaIds,
    pendingAlbumName: state.pendingAlbumName,
    addFiles,
    removeFile,
    cancelAll,
    retryFile,
    retryAll,
    updateField,
    updateTags,
    setPendingAlbumName,
    clearPendingAlbum,
  };
}
