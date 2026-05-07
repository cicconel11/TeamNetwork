export interface MediaDeleteActor {
  isAdmin: boolean;
  currentUserId?: string;
}

interface MediaDeleteCandidate {
  id: string;
  uploaded_by: string;
}

export function canDeleteMediaItem(
  item: Pick<MediaDeleteCandidate, "uploaded_by">,
  actor: MediaDeleteActor,
): boolean {
  return actor.isAdmin || Boolean(actor.currentUserId && item.uploaded_by === actor.currentUserId);
}

export function getBulkDeleteEligibleIds<T extends Pick<MediaDeleteCandidate, "id" | "uploaded_by">>(
  items: T[],
  actor: MediaDeleteActor,
): string[] {
  return items
    .filter((item) => canDeleteMediaItem(item, actor))
    .map((item) => item.id);
}

export function filterBulkDeleteSelection<T extends Pick<MediaDeleteCandidate, "id" | "uploaded_by">>(
  items: T[],
  selectedIds: Iterable<string>,
  actor: MediaDeleteActor,
): string[] {
  const eligibleIds = new Set(getBulkDeleteEligibleIds(items, actor));
  return Array.from(selectedIds).filter((id) => eligibleIds.has(id));
}

export function canDeleteAllMediaItems<T extends Pick<MediaDeleteCandidate, "uploaded_by">>(
  items: T[],
  actor: MediaDeleteActor,
): boolean {
  return items.every((item) => canDeleteMediaItem(item, actor));
}
