import {
  canDeleteAllMediaItems,
  canDeleteMediaItem,
  getBulkDeleteEligibleIds,
  type MediaDeleteActor,
} from "@/lib/media/delete-selection";

interface AlbumCoverCandidate {
  media_type: string | null;
  status: string | null;
}

interface AlbumFallbackCoverCandidate extends AlbumCoverCandidate {
  album_id: string;
  media_item_id: string;
  media_items: {
    storage_path: string | null;
    preview_storage_path?: string | null;
    mime_type?: string | null;
  } | null;
}

interface AlbumItemLike {
  id: string;
  media_type: string;
  status: string;
  uploaded_by: string;
}

interface AlbumLike {
  cover_media_id?: string | null;
  cover_url?: string | null;
  item_count?: number;
}

export type AlbumDeleteMode = "album_only" | "album_and_media";

export interface AlbumFallbackCoverSelection {
  albumId: string;
  mediaId: string;
  storage_path: string;
  preview_storage_path: string | null;
  mime_type: string;
  media_type: "image";
}

export function canUploadDirectlyToAlbum(canUpload: boolean, canEdit: boolean): boolean {
  return canUpload && canEdit;
}

export function getAlbumCoverPickerItems<T extends Pick<AlbumItemLike, "media_type" | "status">>(
  items: T[],
  isAdmin: boolean,
): T[] {
  return items.filter(
    (item) => item.media_type === "image" && (isAdmin || item.status === "approved"),
  );
}

export function canDeleteMediaFromAlbumView(
  item: Pick<AlbumItemLike, "uploaded_by">,
  actor: MediaDeleteActor,
): boolean {
  return canDeleteMediaItem(item, actor);
}

export function getAlbumBulkDeleteEligibleIds<T extends Pick<AlbumItemLike, "id" | "uploaded_by">>(
  items: T[],
  actor: MediaDeleteActor,
): string[] {
  return getBulkDeleteEligibleIds(items, actor);
}

export function canDeleteAlbumAndMedia<T extends Pick<AlbumItemLike, "uploaded_by">>(
  items: T[],
  actor: MediaDeleteActor,
): boolean {
  return canDeleteAllMediaItems(items, actor);
}

export function resolveAlbumDeleteMode(mode: string | null | undefined): AlbumDeleteMode {
  return mode === "album_and_media" ? "album_and_media" : "album_only";
}

export function getAlbumCoverValidationError(candidate: AlbumCoverCandidate | null): string | null {
  if (!candidate) {
    return "Selected cover must belong to this album";
  }
  if (candidate.media_type !== "image") {
    return "Album cover must be an image";
  }
  if (candidate.status !== "approved") {
    return "Album cover must be approved before it can be used";
  }
  return null;
}

export function shouldExposeAlbumCover(
  item: Pick<AlbumCoverCandidate, "status"> | null | undefined,
): boolean {
  return item?.status === "approved";
}

export function getAlbumFallbackCoverSelections<T extends AlbumFallbackCoverCandidate>(
  items: T[],
): AlbumFallbackCoverSelection[] {
  const selected = new Map<string, AlbumFallbackCoverSelection>();

  for (const item of items) {
    if (selected.has(item.album_id)) continue;
    if (item.media_type !== "image") continue;
    if (!shouldExposeAlbumCover(item)) continue;
    if (!item.media_items?.storage_path) continue;

    selected.set(item.album_id, {
      albumId: item.album_id,
      mediaId: item.media_item_id,
      storage_path: item.media_items.storage_path,
      preview_storage_path: item.media_items.preview_storage_path ?? null,
      mime_type: item.media_items.mime_type ?? "application/octet-stream",
      media_type: "image",
    });
  }

  return Array.from(selected.values());
}

export function getAlbumUpdatesAfterMediaDelete(
  album: AlbumLike,
  deletedIds: Iterable<string>,
  deletedCount: number,
): Partial<AlbumLike> {
  const deletedSet = new Set(deletedIds);
  const updates: Partial<AlbumLike> = {};

  if (album.cover_media_id && deletedSet.has(album.cover_media_id)) {
    updates.cover_media_id = null;
    updates.cover_url = null;
  }

  if (typeof album.item_count === "number") {
    updates.item_count = Math.max(0, album.item_count - deletedCount);
  }

  return updates;
}
