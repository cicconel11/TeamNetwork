"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { MediaFilters } from "./MediaFilters";
import { MediaCard, type MediaItem } from "./MediaCard";
import { MediaDetailModal } from "./MediaDetailModal";
import { MediaUploadPanel } from "./MediaUploadPanel";
import { AlbumGrid } from "./AlbumGrid";
import { AlbumView } from "./AlbumView";
import { AlbumPickerModal } from "./AlbumPickerModal";
import type { MediaAlbum } from "./AlbumCard";
import type { UploadFileEntry } from "@/hooks/useGalleryUpload";

interface MediaGalleryProps {
  orgId: string;
  canUpload: boolean;
  isAdmin: boolean;
  currentUserId?: string;
}

type MediaType = "all" | "image" | "video";
type StatusFilter = "all" | "pending" | "approved" | "rejected";
type GalleryView = "albums" | "photos";

export function MediaGallery({ orgId, canUpload, isAdmin, currentUserId }: MediaGalleryProps) {
  // View tab state
  const [view, setView] = useState<GalleryView>("albums");
  const [selectedAlbum, setSelectedAlbum] = useState<MediaAlbum | null>(null);

  // Photos state
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [mediaType, setMediaType] = useState<MediaType>("all");
  const [year, setYear] = useState("");
  const [tag, setTag] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // Modals
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const fetchMedia = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ orgId, limit: "24" });
      if (mediaType !== "all") params.set("mediaType", mediaType);
      if (year) params.set("year", year);
      if (tag) params.set("tag", tag);
      if (isAdmin && statusFilter !== "all") params.set("status", statusFilter);
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/media?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to load media");
      }
      return res.json();
    },
    [orgId, mediaType, year, tag, isAdmin, statusFilter],
  );

  // Only fetch photos when on the photos tab
  useEffect(() => {
    if (view !== "photos") return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchMedia()
      .then((result) => {
        if (cancelled) return;
        setItems(result.data || []);
        setNextCursor(result.nextCursor || null);
        setHasMore(result.hasMore || false);
        setLoading(false);

        const tagSet = new Set<string>();
        (result.data || []).forEach((item: MediaItem) => {
          item.tags.forEach((t: string) => tagSet.add(t));
        });
        setAvailableTags(Array.from(tagSet).sort());
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [fetchMedia, view]);

  // Fetch available years once
  useEffect(() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 10; y--) {
      years.push(y);
    }
    setAvailableYears(years);
  }, []);

  // Exit select mode when switching tabs
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [view]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchMedia(nextCursor);
      setItems((prev) => [...prev, ...(result.data || [])]);
      setNextCursor(result.nextCursor || null);
      setHasMore(result.hasMore || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDelete = async (mediaId: string) => {
    try {
      const res = await fetch(`/api/media/${mediaId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete");
      }
      setItems((prev) => prev.filter((i) => i.id !== mediaId));
      setSelectedItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
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

  const handleModerate = async (mediaId: string, action: "approve" | "reject", rejectionReason?: string) => {
    try {
      const res = await fetch(`/api/media/${mediaId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rejectionReason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to moderate");
      }
      const updated = await res.json();
      const newStatus = action === "approve" ? "approved" : "rejected";
      setItems((prev) => prev.map((i) => (i.id === mediaId ? { ...i, ...updated, status: newStatus } : i)));
      if (selectedItem?.id === mediaId) {
        setSelectedItem((prev) => prev ? { ...prev, ...updated, status: newStatus } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moderation failed");
    }
  };

  // Optimistic insertion when a file finishes uploading
  const handleFileComplete = useCallback(
    (entry: UploadFileEntry, mediaId: string) => {
      const isVideo = entry.mimeType.startsWith("video/");
      const optimisticItem: MediaItem = {
        id: mediaId,
        title: entry.title || entry.fileName,
        description: entry.description || null,
        media_type: isVideo ? "video" : "image",
        url: entry.previewUrl,
        thumbnail_url: isVideo ? null : entry.previewUrl,
        tags: entry.tags,
        taken_at: entry.takenAt ? new Date(entry.takenAt).toISOString() : null,
        created_at: new Date().toISOString(),
        uploaded_by: currentUserId || "",
        status: isAdmin ? "approved" : "pending",
      };

      // Only add to items list if we're on the photos tab
      if (view === "photos") {
        setItems((prev) => [optimisticItem, ...prev]);
      }

      if (entry.tags.length > 0) {
        setAvailableTags((prev) => {
          const set = new Set(prev);
          entry.tags.forEach((t) => set.add(t));
          return Array.from(set).sort();
        });
      }

      fetch(`/api/media/${mediaId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((real: MediaItem | null) => {
          if (!real) return;
          setItems((prev) =>
            prev.map((i) => (i.id === mediaId ? { ...i, ...real } : i)),
          );
        })
        .catch(() => {});
    },
    [currentUserId, isAdmin, view],
  );

  // Callback from MediaUploadPanel after folder upload creates album
  const handleAlbumCreated = useCallback((album: MediaAlbum) => {
    setView("albums");
    setSelectedAlbum(album);
  }, []);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleAlbumPickerSuccess = useCallback((albumId: string, albumName: string) => {
    setShowAlbumPicker(false);
    exitSelectMode();
    setSuccessToast(`Added to "${albumName}"`);
    setTimeout(() => setSuccessToast(null), 3000);
    // Navigate to the album
    setView("albums");
    // We don't have the full album object, so we'll just go to album list
    setSelectedAlbum(null);
  }, [exitSelectMode]);

  const pendingCount = isAdmin ? items.filter((i) => i.status === "pending").length : 0;

  return (
    <div>
      {/* Top bar: tab switcher + upload button */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        {/* Tab pills */}
        <div className="flex items-center rounded-full bg-muted p-1 gap-0.5">
          {(["albums", "photos"] as GalleryView[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                setView(v);
                setSelectedAlbum(null);
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors capitalize ${
                view === v
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "albums" ? "Albums" : "All Photos"}
            </button>
          ))}
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* Status filter + Select mode (photos tab only) */}
          {view === "photos" && (
            <>
              {isAdmin && (
                <div className="flex items-center rounded-full bg-muted p-1 gap-0.5">
                  {(["all", "pending", "approved", "rejected"] as StatusFilter[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1 text-xs font-medium rounded-full transition-colors capitalize ${
                        statusFilter === s
                          ? "bg-org-secondary text-org-secondary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s}
                      {s === "pending" && pendingCount > 0 && statusFilter !== "pending" && (
                        <span className="ml-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-warning text-warning-foreground">
                          {pendingCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Select mode toggle */}
              {items.length > 0 && (
                <button
                  onClick={() => {
                    if (selectMode) {
                      exitSelectMode();
                    } else {
                      setSelectMode(true);
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    selectMode
                      ? "bg-[var(--color-org-secondary)] text-white border-[var(--color-org-secondary)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--color-org-secondary)] hover:text-[var(--color-org-secondary)]"
                  }`}
                >
                  {selectMode ? "Done" : "Select"}
                </button>
              )}

              {/* Select all / Deselect all (select mode only) */}
              {selectMode && items.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSelectedIds(new Set(items.map((i) => i.id)))}
                    className="px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                  >
                    All
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                    >
                      None
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {canUpload && (
            <Button onClick={() => setShowUpload(true)} size="sm">
              Upload
            </Button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* ── Albums view ── */}
      {view === "albums" && !selectedAlbum && (
        <AlbumGrid
          orgId={orgId}
          canCreate={canUpload}
          onSelectAlbum={setSelectedAlbum}
        />
      )}

      {view === "albums" && selectedAlbum && (
        <AlbumView
          album={selectedAlbum}
          orgId={orgId}
          isAdmin={isAdmin}
          canUpload={canUpload}
          currentUserId={currentUserId}
          onBack={() => setSelectedAlbum(null)}
          onAlbumDeleted={() => setSelectedAlbum(null)}
          onAlbumUpdated={(updates) =>
            setSelectedAlbum((prev) => (prev ? { ...prev, ...updates } : null))
          }
        />
      )}

      {/* ── All Photos view ── */}
      {view === "photos" && (
        <>
          {/* Filters row */}
          <div className="mb-4">
            <MediaFilters
              mediaType={mediaType}
              year={year}
              tag={tag}
              availableYears={availableYears}
              availableTags={availableTags}
              onMediaTypeChange={(t) => { setMediaType(t); setTag(""); }}
              onYearChange={setYear}
              onTagChange={setTag}
            />
          </div>

          {loading && (
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
          )}

          {!loading && items.length === 0 && (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
              }
              title="No media yet"
              description="This is where your organization's photos and videos will live. Upload the first one to get started."
              action={
                canUpload ? (
                  <Button onClick={() => setShowUpload(true)}>Upload Media</Button>
                ) : undefined
              }
            />
          )}

          {!loading && items.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {items.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    onClick={() => setSelectedItem(item)}
                    selectable={selectMode}
                    selected={selectedIds.has(item.id)}
                    onToggle={() => toggleItem(item.id)}
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
              onDelete={handleDelete}
              onUpdate={handleUpdate}
              onModerate={isAdmin ? handleModerate : undefined}
            />
          )}

          {/* Floating action bar */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-[var(--card)] border border-[var(--border)] shadow-2xl rounded-2xl px-4 py-3 animate-in slide-in-from-bottom-4 duration-200">
              <span className="text-sm font-medium text-[var(--foreground)] mr-1">
                {selectedIds.size} selected
              </span>
              <Button size="sm" onClick={() => setShowAlbumPicker(true)}>
                Add to album
              </Button>
              <button
                onClick={exitSelectMode}
                className="w-7 h-7 rounded-full hover:bg-[var(--muted)] flex items-center justify-center transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                aria-label="Clear selection"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}

      {/* Album picker modal */}
      {showAlbumPicker && (
        <AlbumPickerModal
          orgId={orgId}
          mediaIds={Array.from(selectedIds)}
          onClose={() => setShowAlbumPicker(false)}
          onSuccess={handleAlbumPickerSuccess}
        />
      )}

      {/* Success toast */}
      {successToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-emerald-600 text-white rounded-2xl px-4 py-2.5 shadow-xl text-sm font-medium animate-in slide-in-from-bottom-4 duration-200">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {successToast}
        </div>
      )}

      {/* Upload panel (available in both views) */}
      <MediaUploadPanel
        orgId={orgId}
        open={showUpload}
        onClose={() => setShowUpload(false)}
        availableTags={availableTags}
        onFileComplete={handleFileComplete}
        onAlbumCreated={handleAlbumCreated}
      />
    </div>
  );
}
