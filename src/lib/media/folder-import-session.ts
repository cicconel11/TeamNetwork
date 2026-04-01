import {
  getFolderAlbumBatchStatus,
  summarizeFolderAlbumBatch,
  type FolderAlbumBatchStatus,
} from "@/lib/media/gallery-upload-flow";

export interface FolderImportFileLike {
  id: string;
  status:
    | "queued"
    | "requesting"
    | "uploading"
    | "finalizing"
    | "associating"
    | "done"
    | "error";
  mediaId: string | null;
}

export interface AlbumImportFields {
  import_status?: Exclude<FolderAlbumBatchStatus, "idle">;
  import_expected_count?: number;
  import_uploaded_count?: number;
  import_failed_count?: number;
}

export interface AlbumImportLike {
  id: string;
  name: string;
  description?: string | null;
  cover_media_id?: string | null;
  cover_url?: string | null;
  item_count: number;
  sort_order?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function buildFolderImportAlbum<T extends AlbumImportLike>(
  album: T | null,
  files: FolderImportFileLike[],
  attachedMediaIds: string[],
): (T & AlbumImportFields) | null {
  if (!album) return null;

  const summary = summarizeFolderAlbumBatch(files, attachedMediaIds);
  const status = getFolderAlbumBatchStatus(summary, album.id);
  const uploadedCount = summary.completedMediaIds.length;
  const failedCount = summary.failedFileIds.length;
  const expectedCount = files.length;

  return {
    ...album,
    item_count: Math.max(album.item_count, attachedMediaIds.length),
    import_status: status,
    import_expected_count: expectedCount,
    import_uploaded_count: uploadedCount,
    import_failed_count: failedCount,
  };
}

export function mergeFolderImportAlbum<T extends AlbumImportLike & Partial<AlbumImportFields>>(
  albums: T[],
  importingAlbum: T | null,
): T[] {
  if (!importingAlbum) return albums;

  const existingIndex = albums.findIndex((album) => album.id === importingAlbum.id);
  if (existingIndex === -1) {
    return [importingAlbum, ...albums];
  }

  return albums.map((album) =>
    album.id === importingAlbum.id
      ? {
          ...album,
          ...importingAlbum,
          cover_url: importingAlbum.cover_url ?? album.cover_url ?? null,
        }
      : album,
  );
}

export function isFolderImportSessionActive(
  pendingAlbumName: string | null,
  files: FolderImportFileLike[],
  albumId: string | null,
): boolean {
  return pendingAlbumName !== null || files.length > 0 || Boolean(albumId);
}
