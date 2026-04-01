export const GALLERY_ALBUM_BATCH_RATE_LIMIT = {
  limitPerIp: 180,
  limitPerUser: 180,
} as const;

interface DraftAlbumLike {
  is_upload_draft?: boolean | null;
  item_count?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
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
