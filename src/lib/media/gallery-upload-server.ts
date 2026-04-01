export const GALLERY_ALBUM_BATCH_RATE_LIMIT = {
  limitPerIp: 180,
  limitPerUser: 180,
} as const;

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
