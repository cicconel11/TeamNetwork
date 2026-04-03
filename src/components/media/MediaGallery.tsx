"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { showFeedback } from "@/lib/feedback/show-feedback";
import {
  BulkDeletePartialError,
  bulkDeleteSelectedMedia,
  getBulkDeletePartialFailureMessage,
  getBulkDeleteSuccessMessage,
} from "@/lib/media/delete-media-client";
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
import {
  buildOptimisticMediaItem,
  mergeUploadTags,
} from "@/lib/media/gallery-upload-client";
import {
  canDeleteMediaItem,
  filterBulkDeleteSelection,
  getBulkDeleteEligibleIds,
} from "@/lib/media/delete-selection";
import { useMediaUploadManager } from "./MediaUploadManagerContext";

interface MediaGalleryProps {
  orgId: string;
  canUpload: boolean;
  isAdmin: boolean;
  currentUserId?: string;
}

type MediaType = "all" | "image" | "video";
type StatusFilter = "all" | "pending" | "approved" | "rejected";
type GalleryView = "albums" | "photos";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function SortableMediaRow({
  item,
  reorderMode,
  reducedMotion,
  selectable,
  selected,
  onToggle,
}: {
  item: MediaItem;
  reorderMode: boolean;
  reducedMotion: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !reorderMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="min-w-0">
      <MediaCard
        item={item}
        onClick={() => {}}
        selectable={selectable}
        selected={selected}
        onToggle={onToggle}
        reorderMode={reorderMode}
        dragHandleProps={reorderMode ? { ...attributes, ...listeners } : undefined}
        isDragging={isDragging}
      />
    </div>
  );
}

export function MediaGallery({ orgId, canUpload, isAdmin, currentUserId }: MediaGalleryProps) {
  const tMedia = useTranslations("media");
  const tCommon = useTranslations("common");
  const { dismissImportAlbum, importingAlbum } = useMediaUploadManager();

  // View tab state
  const [view, setView] = useState<GalleryView>("albums");
  const [selectedAlbum, setSelectedAlbum] = useState<MediaAlbum | null>(null);
  const [hiddenAlbumIds, setHiddenAlbumIds] = useState<Set<string>>(new Set());

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

  // Bulk delete
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // All Photos — manual order (same permission as upload)
  const [photosReorderMode, setPhotosReorderMode] = useState(false);
  const [photosReorderLoading, setPhotosReorderLoading] = useState(false);
  const itemsRef = useRef<MediaItem[]>([]);
  itemsRef.current = items;
  const reducedMotion = usePrefersReducedMotion();
  const displayedSelectedAlbum =
    selectedAlbum && importingAlbum && importingAlbum.id === selectedAlbum.id
      ? { ...selectedAlbum, ...importingAlbum }
      : selectedAlbum;

  const galleryFiltersDefault =
    mediaType === "all" && !year && !tag && (!isAdmin || statusFilter === "all");
  const deleteActor = useMemo(
    () => ({ isAdmin, currentUserId }),
    [isAdmin, currentUserId],
  );
  const eligibleDeleteIds = useMemo(
    () => getBulkDeleteEligibleIds(items, deleteActor),
    [items, deleteActor],
  );

  /** Full-org order requires admin (non-admins only see approved items; RPC needs every row). */
  const canReorderPhotos = canUpload && isAdmin && galleryFiltersDefault;

  const mediaIds = useMemo(() => items.map((i) => i.id), [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  useEffect(() => {
    if (view !== "photos") {
      setPhotosReorderMode(false);
    }
  }, [view]);

  useEffect(() => {
    if (!galleryFiltersDefault) {
      setPhotosReorderMode(false);
    }
  }, [galleryFiltersDefault]);

  useEffect(() => {
    if (photosReorderMode) {
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [photosReorderMode]);

  useEffect(() => {
    if (!selectMode) return;

    setSelectedIds((prev) => {
      const next = filterBulkDeleteSelection(items, prev, deleteActor);
      if (next.length === prev.size) return prev;
      return new Set(next);
    });
  }, [items, deleteActor, selectMode]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore || photosReorderMode) return;
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

  const handleBulkDelete = async () => {
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
      setItems((prev) => prev.filter((i) => !deletedSet.has(i.id)));
      if (selectedItem && deletedSet.has(selectedItem.id)) {
        setSelectedItem(null);
      }
      exitSelectMode();
      showFeedback(getBulkDeleteSuccessMessage(deletedIds.length), "success", { duration: 3000 });
    } catch (err) {
      if (err instanceof BulkDeletePartialError) {
        const deletedSet = new Set(err.deletedIds);
        setItems((prev) => prev.filter((item) => !deletedSet.has(item.id)));
        setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => !deletedSet.has(id))));
        if (selectedItem && deletedSet.has(selectedItem.id)) {
          setSelectedItem(null);
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

  // Reset bulk delete confirm when selection changes
  useEffect(() => {
    setBulkDeleteConfirm(false);
  }, [selectedIds]);

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
      const optimisticItem: MediaItem = buildOptimisticMediaItem(entry, mediaId, {
        currentUserId,
        isAdmin,
      });

      // Only add to items list if we're on the photos tab
      if (view === "photos") {
        setItems((prev) => [optimisticItem, ...prev]);
      }

      if (entry.tags.length > 0) {
        setAvailableTags((prev) => mergeUploadTags(prev, entry.tags));
      }
    },
    [currentUserId, isAdmin, view],
  );

  // Callback from MediaUploadPanel after folder upload creates album
  const handleAlbumCreated = useCallback((album: MediaAlbum) => {
    setHiddenAlbumIds((prev) => {
      if (!prev.has(album.id)) return prev;
      const next = new Set(prev);
      next.delete(album.id);
      return next;
    });
    setView("albums");
    setSelectedAlbum(album);
  }, []);

  const handleAlbumDeleted = useCallback((albumId: string) => {
    setHiddenAlbumIds((prev) => {
      if (prev.has(albumId)) return prev;
      const next = new Set(prev);
      next.add(albumId);
      return next;
    });
    dismissImportAlbum(albumId);
    setSelectedAlbum((prev) => (prev?.id === albumId ? null : prev));
  }, [dismissImportAlbum]);

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

  const persistPhotosReorder = useCallback(async (next: MediaItem[], previous: MediaItem[]) => {
    try {
      const res = await fetch("/api/media/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, mediaIds: next.map((i) => i.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to save order");
      }
      showFeedback("Gallery order saved", "success", { duration: 2500 });
    } catch (err) {
      setItems(previous);
      showFeedback(err instanceof Error ? err.message : "Could not save order", "error", { duration: 4000 });
    }
  }, [orgId]);

  const handlePhotosDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const current = itemsRef.current;
      const oldIndex = current.findIndex((a) => a.id === active.id);
      const newIndex = current.findIndex((a) => a.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(current, oldIndex, newIndex);
      setItems(next);
      void persistPhotosReorder(next, current);
    },
    [persistPhotosReorder],
  );

  const fetchEntireGalleryForReorder = useCallback(async () => {
    const accumulated: MediaItem[] = [];
    let cursor: string | undefined;
    let hasNext = true;
    let guard = 0;
    while (hasNext && guard < 300) {
      guard += 1;
      const p = new URLSearchParams({ orgId, limit: "100" });
      if (cursor) p.set("cursor", cursor);
      const res = await fetch(`/api/media/reorder-dataset?${p.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to load gallery");
      }
      const j = await res.json();
      const batch = (j.data || []) as MediaItem[];
      accumulated.push(...batch);
      cursor = j.nextCursor || undefined;
      hasNext = Boolean(j.hasMore);
    }
    return accumulated;
  }, [orgId]);

  const beginPhotosReorder = useCallback(async () => {
    if (!canReorderPhotos) return;
    setSelectMode(false);
    setSelectedIds(new Set());
    setPhotosReorderLoading(true);
    setError(null);
    try {
      const all = await fetchEntireGalleryForReorder();
      if (all.length === 0) return;
      setItems(all);
      setNextCursor(null);
      setHasMore(false);
      setPhotosReorderMode(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to load gallery";
      setError(msg);
      showFeedback(msg, "error", { duration: 4000 });
    } finally {
      setPhotosReorderLoading(false);
    }
  }, [canReorderPhotos, fetchEntireGalleryForReorder]);

  const exitPhotosReorder = useCallback(() => {
    setPhotosReorderMode(false);
    setError(null);
    fetchMedia()
      .then((result) => {
        setItems(result.data || []);
        setNextCursor(result.nextCursor || null);
        setHasMore(result.hasMore || false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to refresh");
      });
  }, [fetchMedia]);

  const handleAlbumPickerSuccess = useCallback((albumId: string, albumName: string) => {
    setShowAlbumPicker(false);
    exitSelectMode();
    showFeedback(`Added to "${albumName}"`, "success", { duration: 3000 });
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
              {v === "albums" ? tMedia("albums") : tMedia("allPhotos")}
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
              {items.length > 0 && !photosReorderMode && (
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
                  {selectMode ? tCommon("done") : tCommon("select")}
                </button>
              )}

              {/* Select all / Deselect all (select mode only) */}
              {selectMode && items.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSelectedIds(new Set(eligibleDeleteIds))}
                    className="px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                  >
                    {tCommon("all")}
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                    >
                      {tCommon("none")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {canUpload && (
            <Button onClick={() => setShowUpload(true)} size="sm">
              {tCommon("upload")}
            </Button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">{tCommon("dismiss")}</button>
        </div>
      )}

      {view === "photos" && selectMode && !isAdmin && eligibleDeleteIds.length < items.length && (
        <div className="mb-4 text-xs text-muted-foreground">
          Only your uploads can be selected for delete.
        </div>
      )}

      {/* ── Albums view ── */}
      {view === "albums" && !selectedAlbum && (
        <AlbumGrid
          orgId={orgId}
          canCreate={canUpload}
          hiddenAlbumIds={hiddenAlbumIds}
          onSelectAlbum={setSelectedAlbum}
        />
      )}

      {view === "albums" && displayedSelectedAlbum && (
        <AlbumView
          album={displayedSelectedAlbum}
          orgId={orgId}
          isAdmin={isAdmin}
          canUpload={canUpload}
          currentUserId={currentUserId}
          onBack={() => setSelectedAlbum(null)}
          onAlbumDeleted={handleAlbumDeleted}
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

          {canReorderPhotos && !loading && items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5 mb-4">
              <p className="text-sm text-muted-foreground">
                {photosReorderMode
                  ? tMedia("dragToReorder")
                  : tMedia("arrangeGallery")}
              </p>
              <button
                type="button"
                disabled={photosReorderLoading}
                onClick={() => {
                  if (photosReorderMode) {
                    exitPhotosReorder();
                  } else {
                    void beginPhotosReorder();
                  }
                }}
                className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-full border transition-colors disabled:opacity-50 ${
                  photosReorderMode
                    ? "bg-[var(--color-org-secondary)] text-white border-[var(--color-org-secondary)]"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {photosReorderLoading ? tCommon("loading") : photosReorderMode ? tCommon("done") : tMedia("editOrder")}
              </button>
            </div>
          )}

          {canUpload && isAdmin && !loading && items.length > 0 && !galleryFiltersDefault && (
            <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border/70 bg-muted/15 px-3 py-2.5 mb-4">
              {tMedia("clearFiltersToReorder")}
            </p>
          )}

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
              title={tMedia("noMedia")}
              description={tMedia("emptyGallery")}
              action={
                canUpload ? (
                  <Button onClick={() => setShowUpload(true)}>{tMedia("uploadMedia")}</Button>
                ) : undefined
              }
            />
          )}

          {!loading && items.length > 0 && (
            <>
              {photosReorderMode ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePhotosDragEnd}>
                  <div
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 rounded-2xl border border-dashed border-[var(--color-org-secondary)]/40 bg-muted/20 p-3 sm:p-4"
                  >
                    <SortableContext items={mediaIds} strategy={rectSortingStrategy}>
                      {items.map((item) => (
                        <SortableMediaRow
                          key={item.id}
                          item={item}
                          reorderMode
                          reducedMotion={reducedMotion}
                          selectable={false}
                          selected={false}
                          onToggle={() => {}}
                        />
                      ))}
                    </SortableContext>
                  </div>
                </DndContext>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {items.map((item) => (
                    <MediaCard
                      key={item.id}
                      item={item}
                      onClick={() => setSelectedItem(item)}
                      selectable={selectMode}
                      selected={selectedIds.has(item.id)}
                      selectionDisabled={selectMode && !canDeleteMediaItem(item, deleteActor)}
                      onToggle={() => {
                        if (!canDeleteMediaItem(item, deleteActor)) return;
                        toggleItem(item.id);
                      }}
                    />
                  ))}
                </div>
              )}
              {hasMore && !photosReorderMode && (
                <div className="flex justify-center mt-8">
                  <Button variant="secondary" onClick={loadMore} isLoading={loadingMore}>
                    {tCommon("loadMore")}
                  </Button>
                </div>
              )}
            </>
          )}

          {selectedItem && !selectMode && !photosReorderMode && (
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
          {selectedIds.size > 0 && !photosReorderMode && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-[var(--card)] border border-[var(--border)] shadow-2xl rounded-2xl px-4 py-3 animate-in slide-in-from-bottom-4 duration-200">
              <span className="text-sm font-medium text-[var(--foreground)] mr-1">
                {tMedia("selected", { count: selectedIds.size })}
              </span>
              <Button size="sm" onClick={() => setShowAlbumPicker(true)}>
                {tMedia("addToAlbum")}
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant={bulkDeleteConfirm ? "danger" : "secondary"}
                  isLoading={bulkDeleting}
                  onClick={handleBulkDelete}
                >
                  {bulkDeleteConfirm ? tMedia("confirmDeleteCount", { count: selectedIds.size }) : tCommon("delete")}
                </Button>
              )}
              <button
                onClick={exitSelectMode}
                className="w-7 h-7 rounded-full hover:bg-[var(--muted)] flex items-center justify-center transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                aria-label={tMedia("clearSelection")}
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
