"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { MediaCard, type MediaItem } from "./MediaCard";
import { MediaDetailModal } from "./MediaDetailModal";
import type { MediaAlbum } from "./AlbumCard";

interface AlbumViewProps {
  album: MediaAlbum;
  orgId: string;
  isAdmin: boolean;
  canUpload: boolean;
  currentUserId?: string;
  onBack: () => void;
  onAlbumDeleted: () => void;
  onAlbumUpdated?: (updates: Partial<MediaAlbum>) => void;
}

export function AlbumView({
  album,
  orgId,
  isAdmin,
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(album.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = isAdmin || album.created_by === currentUserId;

  const fetchItems = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ orgId, limit: "24" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/media/albums/${album.id}?${params.toString()}`);
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
  }, [fetchItems]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
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

  const handleDeleteAlbum = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/media/albums/${album.id}?orgId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete album");
      }
      onAlbumDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
      setConfirmDelete(false);
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

  return (
    <div>
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

        {/* Admin/creator actions */}
        {canEdit && !editingName && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Button
              variant={confirmDelete ? "danger" : "ghost"}
              size="sm"
              isLoading={deleting}
              onClick={handleDeleteAlbum}
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete ? "Confirm delete" : "Delete album"}
            </Button>
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
          description="Add photos to this album from the All Photos view."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                onClick={() => setSelectedItem(item)}
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

      {selectedItem && (
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
    </div>
  );
}
