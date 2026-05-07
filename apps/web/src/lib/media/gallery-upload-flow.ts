interface UploadProcessingState {
  mediaId: string | null;
  targetAlbumId?: string;
  uploadFinalized: boolean;
}

type FileUploadStatusLike =
  | "queued"
  | "requesting"
  | "uploading"
  | "finalizing"
  | "associating"
  | "done"
  | "error";

export interface FolderAlbumFileLike {
  id: string;
  status: FileUploadStatusLike;
  mediaId: string | null;
}

export interface FolderAlbumBatchSummary {
  completedMediaIds: string[];
  failedFileIds: string[];
  pendingMediaIds: string[];
  allSettled: boolean;
  hasSuccessfulUploads: boolean;
  hasFailures: boolean;
}

export type FolderAlbumBatchStatus =
  | "idle"
  | "waiting_for_uploads"
  | "creating_album"
  | "adding_items"
  | "partial_success"
  | "success"
  | "failed";

export function getGalleryUploadMode(
  state: UploadProcessingState,
): "upload" | "associate-only" {
  if (state.targetAlbumId && state.mediaId && state.uploadFinalized) {
    return "associate-only";
  }
  return "upload";
}

export function getGalleryRetryProgress(uploadFinalized: boolean): number {
  return uploadFinalized ? 100 : 0;
}

export function summarizeFolderAlbumBatch(
  files: FolderAlbumFileLike[],
  attachedMediaIds: string[] = [],
): FolderAlbumBatchSummary {
  const attachedSet = new Set(attachedMediaIds);
  const completedMediaIds = files
    .filter((file) => file.status === "done" && file.mediaId)
    .map((file) => file.mediaId as string);
  const failedFileIds = files
    .filter((file) => file.status === "error")
    .map((file) => file.id);
  const pendingMediaIds = completedMediaIds.filter((mediaId) => !attachedSet.has(mediaId));
  const allSettled = files.length > 0 && files.every((file) => file.status === "done" || file.status === "error");

  return {
    completedMediaIds,
    failedFileIds,
    pendingMediaIds,
    allSettled,
    hasSuccessfulUploads: completedMediaIds.length > 0,
    hasFailures: failedFileIds.length > 0,
  };
}

export function getFolderAlbumBatchStatus(
  summary: FolderAlbumBatchSummary,
  albumId: string | null,
): FolderAlbumBatchStatus {
  if (!summary.allSettled) {
    return "waiting_for_uploads";
  }

  if (!summary.hasSuccessfulUploads) {
    return "failed";
  }

  if (summary.pendingMediaIds.length > 0 || !albumId) {
    return albumId ? "adding_items" : "creating_album";
  }

  return summary.hasFailures ? "partial_success" : "success";
}
