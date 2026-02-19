"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { MediaFilters } from "./MediaFilters";
import { MediaCard, type MediaItem } from "./MediaCard";
import { MediaDetailModal } from "./MediaDetailModal";
import { MediaUploadPanel } from "./MediaUploadPanel";
import type { UploadFileEntry } from "@/hooks/useGalleryUpload";

interface MediaGalleryProps {
  orgId: string;
  canUpload: boolean;
  isAdmin: boolean;
  currentUserId?: string;
}

type MediaType = "all" | "image" | "video";
type StatusFilter = "all" | "pending" | "approved" | "rejected";

export function MediaGallery({ orgId, canUpload, isAdmin, currentUserId }: MediaGalleryProps) {
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

  // Initial load + filter changes
  useEffect(() => {
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

        // Extract tags from first page for filter chips
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
  }, [fetchMedia]);

  // Fetch available years once
  useEffect(() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 10; y--) {
      years.push(y);
    }
    setAvailableYears(years);
  }, []);

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

  const handleUpdate = async (mediaId: string, data: { title?: string; description?: string; tags?: string[] }) => {
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
      setItems((prev) => [optimisticItem, ...prev]);

      // Also update available tags with any new tags
      if (entry.tags.length > 0) {
        setAvailableTags((prev) => {
          const set = new Set(prev);
          entry.tags.forEach((t) => set.add(t));
          return Array.from(set).sort();
        });
      }

      // Background-fetch the real item with signed URLs to replace the optimistic entry
      fetch(`/api/media/${mediaId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((real: MediaItem | null) => {
          if (!real) return;
          setItems((prev) =>
            prev.map((i) => (i.id === mediaId ? { ...i, ...real } : i)),
          );
        })
        .catch(() => {
          // Optimistic item stays — signed URL will appear on next page load
        });
    },
    [currentUserId, isAdmin],
  );

  const pendingCount = isAdmin ? items.filter((i) => i.status === "pending").length : 0;

  return (
    <div>
      {/* Filters + Upload button row */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
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
        <div className="flex items-center gap-2">
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

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border overflow-hidden">
              <div className="aspect-[4/3] bg-muted animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
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

      {/* Grid */}
      {!loading && items.length > 0 && (
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

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center mt-8">
              <Button
                variant="secondary"
                onClick={loadMore}
                isLoading={loadingMore}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {/* Detail modal */}
      {selectedItem && (
        <MediaDetailModal
          item={selectedItem}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={() => setSelectedItem(null)}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
          onModerate={isAdmin ? handleModerate : undefined}
        />
      )}

      {/* Upload panel */}
      <MediaUploadPanel
        orgId={orgId}
        open={showUpload}
        onClose={() => setShowUpload(false)}
        availableTags={availableTags}
        onFileComplete={handleFileComplete}
      />
    </div>
  );
}
