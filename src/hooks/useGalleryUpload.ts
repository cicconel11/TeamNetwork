"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  validateGalleryFile,
  deriveDefaultTitle,
  detectDuplicate,
  resolveGalleryMimeType,
  checkBatchLimit,
} from "@/lib/media/gallery-validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileUploadStatus =
  | "queued"
  | "requesting"
  | "uploading"
  | "finalizing"
  | "done"
  | "error";

export interface UploadFileEntry {
  id: string;
  file: File | null; // nulled after upload completes to free memory
  fileName: string;
  fileSize: number;
  mimeType: string;
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
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: "ADD_FILES"; entries: UploadFileEntry[] }
  | { type: "UPDATE_FIELD"; id: string; field: "title" | "description" | "takenAt"; value: string }
  | { type: "UPDATE_TAGS"; id: string; tags: string[] }
  | { type: "SET_STATUS"; id: string; status: FileUploadStatus; error?: string }
  | { type: "SET_PROGRESS"; id: string; progress: number }
  | { type: "SET_MEDIA_ID"; id: string; mediaId: string }
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

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_FILES":
      return { ...state, files: [...state.files, ...action.entries] };

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

    case "MARK_DONE":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id
            ? { ...f, status: "done", progress: 100, file: null, error: null }
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

const MAX_CONCURRENT = 3;
const STAGGER_MS = 500;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseGalleryUploadOptions {
  orgId: string;
  onFileComplete?: (entry: UploadFileEntry, mediaId: string) => void;
}

export function useGalleryUpload({ orgId, onFileComplete }: UseGalleryUploadOptions) {
  const [state, dispatch] = useReducer(reducer, {
    files: [],
    completedMediaIds: [],
    pendingAlbumName: null,
  });
  const xhrRefs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const processingRef = useRef<Set<string>>(new Set());
  const lastDispatchTime = useRef(0);
  const onFileCompleteRef = useRef(onFileComplete);
  onFileCompleteRef.current = onFileComplete;

  // ------- Add files -------
  const addFiles = useCallback(
    (newFiles: File[]) => {
      const batchCheck = checkBatchLimit(newFiles.length);
      if (!batchCheck.valid) {
        return { rejected: newFiles.map((f) => ({ name: f.name, error: batchCheck.error! })) };
      }

      const existingEntries = state.files.map((f) => ({
        name: f.fileName,
        size: f.fileSize,
      }));

      const entries: UploadFileEntry[] = [];
      const rejected: { name: string; error: string }[] = [];

      for (const file of newFiles) {
        const validation = validateGalleryFile(file);
        if (!validation.valid) {
          rejected.push({ name: file.name, error: validation.error! });
          continue;
        }

        if (detectDuplicate(file, existingEntries)) {
          rejected.push({ name: file.name, error: "File already in queue." });
          continue;
        }

        const mimeType = resolveGalleryMimeType(file);
        const previewUrl = URL.createObjectURL(file);

        const entry: UploadFileEntry = {
          id: crypto.randomUUID(),
          file,
          fileName: file.name,
          fileSize: file.size,
          mimeType,
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
        };

        entries.push(entry);
        existingEntries.push({ name: file.name, size: file.size });
      }

      if (entries.length > 0) {
        dispatch({ type: "ADD_FILES", entries });
      }

      return { rejected };
    },
    [state.files],
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
      if (!entry.file) return;

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

        const { mediaId, signedUrl, token } = await intentRes.json();
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

        dispatch({ type: "SET_STATUS", id: entry.id, status: "finalizing" });
        dispatch({ type: "SET_PROGRESS", id: entry.id, progress: 100 });

        const finalizeRes = await fetch(`/api/media/${mediaId}/finalize`, {
          method: "POST",
        });

        if (!finalizeRes.ok) {
          const data = await finalizeRes.json().catch(() => null);
          throw new Error(data?.error || "Failed to finalize upload");
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
    [orgId],
  );

  // ------- Concurrency dispatcher -------
  useEffect(() => {
    const activeCount = state.files.filter(
      (f) => f.status === "requesting" || f.status === "uploading" || f.status === "finalizing",
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
        progress: 0,
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
    xhrRefs.current.forEach((xhr) => xhr.abort());
    xhrRefs.current.clear();

    state.files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });

    processingRef.current.clear();
    dispatch({ type: "CLEAR_ALL" });
  }, [state.files]);

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
      (f) => f.status === "requesting" || f.status === "uploading" || f.status === "finalizing",
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
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      state.files.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
      xhrRefs.current.forEach((xhr) => xhr.abort());
    };
    // We intentionally only run this on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- Derived stats -------
  const stats = {
    total: state.files.length,
    queued: state.files.filter((f) => f.status === "queued").length,
    active: state.files.filter(
      (f) => f.status === "requesting" || f.status === "uploading" || f.status === "finalizing",
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
      (f) => f.status === "requesting" || f.status === "uploading" || f.status === "finalizing",
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
