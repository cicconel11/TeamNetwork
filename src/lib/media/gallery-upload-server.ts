export const GALLERY_ALBUM_BATCH_RATE_LIMIT = {
  limitPerIp: 180,
  limitPerUser: 180,
} as const;

interface GalleryUploadRpcErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

interface GalleryUploadRecordInput {
  orgId: string;
  uploadedBy: string;
  storagePath: string;
  previewStoragePath?: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  mediaType: "image" | "video";
  title: string;
  description?: string | null;
  tags?: string[];
  takenAt?: string | null;
  status?: string;
}

export interface GalleryUploadRecordClient {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        is: (column: string, value: unknown) => {
          order: (
            column: string,
            options: { ascending: boolean },
          ) => {
            limit: (value: number) => {
              maybeSingle: () => Promise<{ data: { gallery_sort_order?: number | null } | null; error: unknown }>;
            };
          };
        };
      };
    };
    insert: (payload: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string } | null; error: unknown }>;
      };
    };
  };
}

interface DraftColumnErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

interface DraftAlbumLike {
  is_upload_draft?: boolean | null;
  item_count?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
}

interface DraftColumnQueryResult<T> {
  data: T | null;
  error: unknown;
}

interface DraftColumnFallbackOptions<T> {
  withDraftColumn: () => Promise<DraftColumnQueryResult<T>>;
  withoutDraftColumn: () => Promise<DraftColumnQueryResult<T>>;
}

interface DraftColumnFallbackResult<T> extends DraftColumnQueryResult<T> {
  usedDraftColumn: boolean;
}

export function getNextGallerySortOrder(currentMinSortOrder: number | null): number {
  return currentMinSortOrder === null ? 0 : currentMinSortOrder - 1;
}

export function isMissingCreateMediaGalleryUploadRpcError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as GalleryUploadRpcErrorLike;
  const haystack = [maybeError.code, maybeError.message, maybeError.details, maybeError.hint]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (!haystack.includes("create_media_gallery_upload")) return false;

  return (
    haystack.includes("42883") ||
    haystack.includes("pgrst202") ||
    haystack.includes("does not exist") ||
    haystack.includes("could not find") ||
    haystack.includes("no function matches")
  );
}

export async function createMediaGalleryUploadRecord(
  client: GalleryUploadRecordClient,
  input: GalleryUploadRecordInput,
): Promise<{ mediaId: string; creationPath: "rpc" | "fallback" }> {
  const { data, error } = await client.rpc("create_media_gallery_upload", {
    p_org_id: input.orgId,
    p_uploaded_by: input.uploadedBy,
    p_storage_path: input.storagePath,
    p_preview_storage_path: input.previewStoragePath ?? null,
    p_file_name: input.fileName,
    p_mime_type: input.mimeType,
    p_file_size_bytes: input.fileSizeBytes,
    p_media_type: input.mediaType,
    p_title: input.title,
    p_description: input.description ?? null,
    p_tags: input.tags ?? [],
    p_taken_at: input.takenAt ?? null,
    p_status: input.status ?? "uploading",
  });

  if (!error && typeof data === "string" && data.length > 0) {
    return { mediaId: data, creationPath: "rpc" };
  }

  if (error && !isMissingCreateMediaGalleryUploadRpcError(error)) {
    throw error;
  }

  const { data: firstGalleryItem, error: sortOrderError } = await client
    .from("media_items")
    .select("gallery_sort_order")
    .eq("organization_id", input.orgId)
    .is("deleted_at", null)
    .order("gallery_sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (sortOrderError) {
    throw sortOrderError;
  }

  const nextGallerySortOrder = getNextGallerySortOrder(
    typeof firstGalleryItem?.gallery_sort_order === "number"
      ? firstGalleryItem.gallery_sort_order
      : null,
  );

  const { data: mediaItem, error: insertError } = await client
    .from("media_items")
    .insert({
      organization_id: input.orgId,
      uploaded_by: input.uploadedBy,
      storage_path: input.storagePath,
      preview_storage_path: input.previewStoragePath ?? null,
      file_name: input.fileName,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      media_type: input.mediaType,
      title: input.title,
      description: input.description ?? null,
      tags: input.tags ?? [],
      taken_at: input.takenAt ?? null,
      status: input.status ?? "uploading",
      gallery_sort_order: nextGallerySortOrder,
    })
    .select("id")
    .single();

  if (insertError || !mediaItem?.id) {
    throw insertError ?? new Error("Failed to create media item");
  }

  return { mediaId: mediaItem.id, creationPath: "fallback" };
}

export function shouldListMediaAlbum(album: DraftAlbumLike): boolean {
  return !(album.is_upload_draft && (album.item_count ?? 0) === 0);
}

export function isStaleEmptyUploadDraftAlbum(album: DraftAlbumLike, cutoffIso: string): boolean {
  if (!album.is_upload_draft) return false;
  if ((album.item_count ?? 0) > 0) return false;
  if (album.deleted_at) return false;
  if (!album.created_at) return false;
  return album.created_at < cutoffIso;
}

export function isMissingMediaAlbumsDraftColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as DraftColumnErrorLike;
  const haystack = [maybeError.code, maybeError.message, maybeError.details, maybeError.hint]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (!haystack.includes("is_upload_draft")) return false;

  return (
    haystack.includes("42703") ||
    haystack.includes("pgrst204") ||
    haystack.includes("does not exist") ||
    haystack.includes("could not find")
  );
}

export async function withMediaAlbumsDraftColumnFallback<T>(
  options: DraftColumnFallbackOptions<T>,
): Promise<DraftColumnFallbackResult<T>> {
  const resultWithDraftColumn = await options.withDraftColumn();
  if (!isMissingMediaAlbumsDraftColumnError(resultWithDraftColumn.error)) {
    return {
      ...resultWithDraftColumn,
      usedDraftColumn: true,
    };
  }

  const resultWithoutDraftColumn = await options.withoutDraftColumn();
  return {
    ...resultWithoutDraftColumn,
    usedDraftColumn: false,
  };
}
