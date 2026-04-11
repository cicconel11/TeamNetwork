"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { showFeedback } from "@/lib/feedback/show-feedback";
import {
  BulkDeletePartialError,
  bulkDeleteSelectedMedia,
  getBulkDeletePartialFailureMessage,
  getBulkDeleteSuccessMessage,
} from "@/lib/media/delete-media-client";
import { Button, EmptyState } from "@/components/ui";
import { MediaCard, type MediaItem } from "./MediaCard";
import { MediaDetailModal } from "./MediaDetailModal";
import { MediaUploadPanel } from "./MediaUploadPanel";
import { CoverPickerModal } from "./CoverPickerModal";
import type { MediaAlbum } from "./AlbumCard";
import type { UploadFileEntry } from "@/hooks/useGalleryUpload";
import {
  canDeleteAlbumAndMedia,
  canDeleteMediaFromAlbumView,
  type AlbumDeleteMode,
  canUploadDirectlyToAlbum,
  getAlbumBulkDeleteEligibleIds,
  getAlbumCoverPickerItems,
  getAlbumUpdatesAfterMediaDelete,
} from "@/lib/media/albums";
import { buildOptimisticMediaItem } from "@/lib/media/gallery-upload-client";

interface AlbumViewProps {
  album: MediaAlbum;
  orgId: string;
  isAdmin: boolean;
  canUpload: boolean;
  currentUserId?: string;
  onBack: () => void;
  onAlbumDeleted: (albumId: string) => void;
  onAlbumUpdated?: (updates: Partial<MediaAlbum>) => void;
}

export function AlbumView({
  album,
  orgId,
  isAdmin,
  canUpload,
  currentUserId,
  onBack,
  onAlbumDeleted,
  onAlbumUpdated,
}: AlbumViewProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingMode, setDeletingMode] = useState<AlbumDeleteMode | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Upload to album
  const [showUpload, setShowUpload] = useState(false);

  // Cover picker
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [coverSaving, setCoverSaving] = useState(false);

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(album.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = isAdmin || album.created_by === currentUserId;
  const canDirectUpload = canUploadDirectlyToAlbum(canUpload, canEdit);
  const deleteActor = { isAdmin, currentUserId };
  const eligibleDeleteIds = getAlbumBulkDeleteEligibleIds(items, deleteActor);
  const canDeleteAlbumPhotos = canDeleteAlbumAndMedia(items, deleteActor);
  const coverPickerItems = getAlbumCoverPickerItems(items, isAdmin);

  const fetchItems = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ orgId, limit: "24" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/media/albums/${album.id}?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to load album");
      }
      return res.json();
    },
    [album.id, orgId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchItems()
      .then((result) => {
        if (cancelled) return;
        setItems(result.data || []);
        setNextCursor(result.nextCursor || null);
        setHasMore(result.hasMore || false);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [album.import_failed_count, album.import_uploaded_count, fetchItems]);

  useEffect(() => {
    setBulkDeleteConfirm(false);
  }, [selectedIds]);

  useEffect(() => {
    if (!selectMode) return;

    const eligibleSet = new Set(eligibleDeleteIds);
    setSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => eligibleSet.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [eligibleDeleteIds, selectMode]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchItems(nextCursor);
      setItems((prev) => [...prev, ...(result.data || [])]);
      setNextCursor(result.nextCursor || null);
      setHasMore(result.hasMore || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleItem = useCallback((mediaId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) {
        next.delete(mediaId);
      } else {
        next.add(mediaId);
      }
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  }, []);

  const handleRemoveFromAlbum = async (mediaId: string) => {
    try {
      const res = await fetch(
        `/api/media/albums/${album.id}/items/${mediaId}?orgId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to remove");
      }
      setItems((prev) => prev.filter((i) => i.id !== mediaId));
      setSelectedItem(null);
      const albumUpdates = getAlbumUpdatesAfterMediaDelete(album, [mediaId], 1);
      if (Object.keys(albumUpdates).length > 0) {
        onAlbumUpdated?.(albumUpdates);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!bulkDeleteConfirm) {
      setBulkDeleteConfirm(true);
      return;
    }

    setBulkDeleting(true);
    try {
      const { deletedIds } = await bulkDeleteSelectedMedia({
        orgId,
        mediaIds: Array.from(selectedIds),
      });
      const deletedSet = new Set(deletedIds);
      setItems((prev) => prev.filter((item) => !deletedSet.has(item.id)));
      if (selectedItem && deletedSet.has(selectedItem.id)) {
        setSelectedItem(null);
      }

      const albumUpdates = getAlbumUpdatesAfterMediaDelete(album, deletedSet, deletedSet.size);
      if (Object.keys(albumUpdates).length > 0) {
        onAlbumUpdated?.(albumUpdates);
      }

      exitSelectMode();
      showFeedback(
        getBulkDeleteSuccessMessage(deletedSet.size),
        "success",
        { duration: 3000 },
      );
    } catch (err) {
      if (err instanceof BulkDeletePartialError) {
        const deletedSet = new Set(err.deletedIds);
        setItems((prev) => prev.filter((item) => !deletedSet.has(item.id)));
        setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => !deletedSet.has(id))));
        if (selectedItem && deletedSet.has(selectedItem.id)) {
          setSelectedItem(null);
        }

        const albumUpdates = getAlbumUpdatesAfterMediaDelete(album, deletedSet, deletedSet.size);
        if (Object.keys(albumUpdates).length > 0) {
          onAlbumUpdated?.(albumUpdates);
        }

        showFeedback(
          getBulkDeletePartialFailureMessage(err.deletedIds.length, err.failedIds.length),
          "error",
          { duration: 4000 },
        );
        return;
      }
      setError(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirm(false);
    }
  };

  const handleUpdate = async (mediaId: string, data: { description?: string; tags?: string[] }) => {
    try {
      const res = await fetch(`/api/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const resData = await res.json().catch(() => null);
        throw new Error(resData?.error || "Failed to update");
      }
      const updated = await res.json();
      setItems((prev) => prev.map((i) => (i.id === mediaId ? { ...i, ...updated } : i)));
      if (selectedItem?.id === mediaId) {
        setSelectedItem((prev) => prev ? { ...prev, ...updated } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleDeleteAlbum = async (mode: AlbumDeleteMode) => {
    setDeletingMode(mode);
    try {
      const params = new URLSearchParams({ orgId, mode });
      const res = await fetch(
        `/api/media/albums/${album.id}?${params.toString()}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete album");
      }
      setShowDeleteModal(false);
      onAlbumDeleted(album.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeletingMode(null);
    }
  };

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === album.name) {
      setEditingName(false);
      setNameValue(album.name);
      return;
    }

    // Optimistic update
    setEditingName(false);
    setNameSaving(true);

    try {
      const res = await fetch(`/api/media/albums/${album.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to rename album");
      }
      onAlbumUpdated?.({ name: trimmed });
    } catch (err) {
      // Revert on error
      setNameValue(album.name);
      const msg = err instanceof Error ? err.message : "Failed to rename album";
      setNameError(msg);
      if (nameErrorTimerRef.current) clearTimeout(nameErrorTimerRef.current);
      nameErrorTimerRef.current = setTimeout(() => setNameError(null), 3000);
    } finally {
      setNameSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingName(false);
    setNameValue(album.name);
  };

  // Handle upload completion — add to album item list optimistically
  const handleFileComplete = useCallback(
    (entry: UploadFileEntry, mediaId: string) => {
      const optimisticItem: MediaItem = buildOptimisticMediaItem(entry, mediaId, {
        currentUserId,
        isAdmin,
      });
      setItems((prev) => [optimisticItem, ...prev]);
    },
    [currentUserId, isAdmin],
  );

  // Set album cover
  const handleSetCover = async (mediaId: string, coverUrl: string) => {
    setCoverSaving(true);
    try {
      const res = await fetch(`/api/media/albums/${album.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, cover_media_id: mediaId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to set cover");
      }
      onAlbumUpdated?.({ cover_media_id: mediaId, cover_url: coverUrl });
      setShowCoverPicker(false);
      showFeedback("Album cover updated", "success", { duration: 3000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set cover");
    } finally {
      setCoverSaving(false);
    }
  };

  return (
    <div>
      {album.import_status && album.import_status !== "success" && (
        <div className="mb-4 rounded-xl border border-[var(--color-org-secondary)]/20 bg-[var(--color-org-secondary)]/8 px-4 py-3">
          <p className="text-sm font-medium text-[var(--foreground)]">{getAlbumImportHeadline(album)}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{getAlbumImportDetail(album)}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Albums
        </button>
        <span className="text-muted-foreground shrink-0">/</span>

        {/* Album name — editable or static */}
        {canEdit ? (
          editingName ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <input
                autoFocus
                className="text-base font-semibold bg-transparent border-b-2 border-[var(--color-org-secondary)] outline-none min-w-0 flex-1 text-foreground py-0.5"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") handleCancelEdit();
                }}
                maxLength={200}
                disabled={nameSaving}
              />
              {/* Save */}
              <button
                onClick={handleSaveName}
                disabled={nameSaving || !nameValue.trim()}
                aria-label="Save name"
                className="w-6 h-6 rounded-full bg-[var(--color-org-secondary)] text-white flex items-center justify-center shrink-0 disabled:opacity-50 transition-opacity"
              >
                {nameSaving ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              {/* Cancel */}
              <button
                onClick={handleCancelEdit}
                aria-label="Cancel rename"
                className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 hover:text-foreground transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-1.5 min-w-0">
              <h2
                className="text-base font-semibold text-foreground truncate cursor-pointer group-hover:text-[var(--color-org-secondary)] transition-colors"
                onClick={() => { setNameValue(album.name); setEditingName(true); }}
                title="Click to rename"
              >
                {nameValue}
              </h2>
              <button
                onClick={() => { setNameValue(album.name); setEditingName(true); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground hover:text-[var(--color-org-secondary)]"
                aria-label="Rename album"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                </svg>
              </button>
            </div>
          )
        ) : (
          <h2 className="text-base font-semibold text-foreground truncate">{nameValue}</h2>
        )}

        {/* Actions */}
        {!editingName && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {canEdit && items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowCoverPicker(true)}>
                Set cover
              </Button>
            )}
            {items.length > 0 && eligibleDeleteIds.length > 0 && (
              <Button
                variant={selectMode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  if (selectMode) {
                    exitSelectMode();
                  } else {
                    setSelectMode(true);
                  }
                }}
              >
                {selectMode ? "Done" : "Select"}
              </Button>
            )}
            {selectMode && (
              <>
                <button
                  onClick={() => setSelectedIds(new Set(eligibleDeleteIds))}
                  className="px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  All
                </button>
                {selectedIds.size > 0 && (
                  <Button
                    variant={bulkDeleteConfirm ? "danger" : "ghost"}
                    size="sm"
                    isLoading={bulkDeleting}
                    onClick={handleBulkDelete}
                  >
                    {bulkDeleteConfirm ? "Confirm delete" : `Delete ${selectedIds.size}`}
                  </Button>
                )}
              </>
            )}
            {canDirectUpload && (
              <Button size="sm" onClick={() => setShowUpload(true)}>
                Upload
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteModal(true)}
              >
                Delete album
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Name error */}
      {nameError && (
        <div className="mb-3 text-xs text-red-600 dark:text-red-400">
          {nameError}
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {selectMode && !isAdmin && eligibleDeleteIds.length < items.length && (
        <div className="mb-4 text-xs text-muted-foreground">
          Only your uploads can be selected for delete.
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border overflow-hidden">
              <div className="aspect-[4/3] bg-muted animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M2.25 18.75h19.5" />
            </svg>
          }
          title="No photos in this album"
          description={canDirectUpload ? "Upload photos directly to this album." : "Add photos to this album from the All Photos view."}
          action={
            canDirectUpload ? (
              <Button onClick={() => setShowUpload(true)}>Upload Photos</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                onClick={() => setSelectedItem(item)}
                selectable={selectMode}
                selected={selectedIds.has(item.id)}
                selectionDisabled={selectMode && !canDeleteMediaFromAlbumView(item, deleteActor)}
                onToggle={() => {
                  if (!canDeleteMediaFromAlbumView(item, deleteActor)) return;
                  toggleItem(item.id);
                }}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-8">
              <Button variant="secondary" onClick={loadMore} isLoading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {selectedItem && !selectMode && (
        <MediaDetailModal
          item={selectedItem}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          orgId={orgId}
          onClose={() => setSelectedItem(null)}
          onDelete={handleRemoveFromAlbum}
          onUpdate={handleUpdate}
        />
      )}

      {/* Upload panel — uploads directly into this album */}
      <MediaUploadPanel
        orgId={orgId}
        open={showUpload}
        onClose={() => setShowUpload(false)}
        availableTags={[]}
        targetAlbumId={album.id}
        targetAlbumName={album.name}
        onFileComplete={handleFileComplete}
      />

      {/* Cover picker modal */}
      {showCoverPicker && (
        <CoverPickerModal
          items={coverPickerItems}
          currentCoverId={album.cover_media_id ?? null}
          onSelect={handleSetCover}
          onClose={() => setShowCoverPicker(false)}
          saving={coverSaving}
        />
      )}

      {showDeleteModal && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={() => {
              if (!deletingMode) setShowDeleteModal(false);
            }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              role="dialog"
              aria-label="Delete album options"
              className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            >
              <div className="border-b border-[var(--border)] px-5 py-4">
                <h3 className="text-base font-semibold text-[var(--foreground)]">Delete album</h3>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Choose whether to keep this album&apos;s photos in All Photos or remove them too.
                </p>
              </div>

              <div className="space-y-3 px-5 py-4">
                <button
                  type="button"
                  onClick={() => void handleDeleteAlbum("album_only")}
                  disabled={deletingMode !== null}
                  className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-left transition-colors hover:border-[var(--foreground)]/20 hover:bg-[var(--muted)] disabled:opacity-60"
                >
                  <p className="text-sm font-semibold text-[var(--foreground)]">Delete album only</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    The album goes away, but all {items.length} photo{items.length === 1 ? "" : "s"} stay in All Photos.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => void handleDeleteAlbum("album_and_media")}
                  disabled={deletingMode !== null || !canDeleteAlbumPhotos}
                  className="w-full rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-left transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-red-950/20"
                >
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">Delete album and all photos</p>
                  <p className="mt-1 text-xs text-red-600/90 dark:text-red-300/80">
                    This removes the album and deletes its {items.length} photo{items.length === 1 ? "" : "s"} from All Photos.
                  </p>
                </button>

                {!canDeleteAlbumPhotos && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Delete album and all photos is only available when you can delete every upload in this album.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
                <Button
                  variant="secondary"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deletingMode !== null}
                >
                  Cancel
                </Button>
                {deletingMode && (
                  <span className="self-center text-xs text-[var(--muted-foreground)]">
                    Deleting...
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function getAlbumImportHeadline(album: MediaAlbum): string {
  switch (album.import_status) {
    case "creating_album":
      return "Creating album import";
    case "partial_success":
      return "Album import finished with some failures";
    case "failed":
      return "Album import failed";
    default:
      return "Album import in progress";
  }
}

function getAlbumImportDetail(album: MediaAlbum): string {
  const uploaded = album.import_uploaded_count ?? 0;
  const expected = album.import_expected_count ?? 0;
  const failed = album.import_failed_count ?? 0;

  if (album.import_status === "failed") {
    return failed > 0
      ? `${failed} file${failed === 1 ? "" : "s"} failed before the album could finish importing.`
      : "The album is waiting for another retry to complete.";
  }

  if (album.import_status === "partial_success") {
    return `${uploaded} of ${expected} files finished importing. Retry the failed uploads to complete the album.`;
  }

  return `${uploaded} of ${expected} files imported so far. You can leave this page while the upload continues.`;
}
