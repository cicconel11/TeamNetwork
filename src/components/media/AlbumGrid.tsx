"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
import { mergeFolderImportAlbum } from "@/lib/media/folder-import-session";
import { AlbumCard, type MediaAlbum } from "./AlbumCard";
import { CreateAlbumModal } from "./CreateAlbumModal";
import { useMediaUploadManager } from "./MediaUploadManagerContext";

interface AlbumGridProps {
  orgId: string;
  canCreate: boolean;
  onSelectAlbum: (album: MediaAlbum) => void;
}

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

function SortableAlbumRow({
  album,
  reorderMode,
  onSelectAlbum,
  reducedMotion,
}: {
  album: MediaAlbum;
  reorderMode: boolean;
  onSelectAlbum: (album: MediaAlbum) => void;
  reducedMotion: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: album.id, disabled: !reorderMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="min-w-0">
      <AlbumCard
        album={album}
        onClick={() => onSelectAlbum(album)}
        reorderMode={reorderMode}
        dragHandleProps={reorderMode ? { ...attributes, ...listeners } : undefined}
        isDragging={isDragging}
      />
    </div>
  );
}

export function AlbumGrid({ orgId, canCreate, onSelectAlbum }: AlbumGridProps) {
  const tMedia = useTranslations("media");
  const tCommon = useTranslations("common");
  const { importingAlbum } = useMediaUploadManager();

  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const albumsRef = useRef<MediaAlbum[]>([]);
  const visibleAlbums = useMemo(
    () => mergeFolderImportAlbum(albums, importingAlbum),
    [albums, importingAlbum],
  );
  albumsRef.current = visibleAlbums;

  const canReorder = canCreate;

  const fetchAlbums = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/albums?orgId=${encodeURIComponent(orgId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || tMedia("failedToLoadAlbums"));
      }
      const result = await res.json();
      setAlbums(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : tMedia("failedToLoadAlbums"));
    } finally {
      setLoading(false);
    }
  }, [orgId, tMedia]);

  useEffect(() => {
    fetchAlbums();
  }, [fetchAlbums]);

  const albumIds = useMemo(() => visibleAlbums.map((a) => a.id), [visibleAlbums]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistReorder = useCallback(async (next: MediaAlbum[], previous: MediaAlbum[]) => {
    try {
      const res = await fetch("/api/media/albums/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, albumIds: next.map((a) => a.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to save order");
      }
      showFeedback("Album order saved", "success", { duration: 2500 });
    } catch (err) {
      setAlbums(previous);
      showFeedback(err instanceof Error ? err.message : "Could not save order", "error", { duration: 4000 });
    }
  }, [orgId]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const current = albumsRef.current;
      const oldIndex = current.findIndex((a) => a.id === active.id);
      const newIndex = current.findIndex((a) => a.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(current, oldIndex, newIndex);
      setAlbums(next);
      void persistReorder(next, current);
    },
    [persistReorder],
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border overflow-hidden">
            <div className="aspect-[4/3] bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
        {error}
        <button type="button" onClick={fetchAlbums} className="ml-2 underline">{tCommon("retry")}</button>
      </div>
    );
  }

  return (
    <>
      {albums.length === 0 && !canCreate ? (
        <EmptyState
          icon={
            <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M2.25 18.75h19.5" />
            </svg>
          }
          title={tMedia("noAlbums")}
          description={tMedia("albumsDesc")}
        />
      ) : (
        <div className="space-y-4">
          {canReorder && albums.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5">
              <p className="text-sm text-muted-foreground">
                {reorderMode
                  ? tMedia("dragAlbums")
                  : tMedia("arrangeAlbums")}
              </p>
              <button
                type="button"
                onClick={() => setReorderMode((v) => !v)}
                className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-full border transition-colors ${
                  reorderMode
                    ? "bg-[var(--color-org-secondary)] text-white border-[var(--color-org-secondary)]"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {reorderMode ? tCommon("done") : tMedia("editOrder")}
              </button>
            </div>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 ${
                reorderMode ? "rounded-2xl border border-dashed border-[var(--color-org-secondary)]/40 bg-muted/20 p-3 sm:p-4" : ""
              }`}
            >
              {canCreate && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="group relative aspect-[4/3] rounded-xl border-2 border-dashed border-border hover:border-muted-foreground transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <div className="w-12 h-12 rounded-full border-2 border-current flex items-center justify-center transition-transform group-hover:scale-110">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium">{tMedia("newAlbum")}</span>
                </button>
              )}

              <SortableContext items={albumIds} strategy={rectSortingStrategy}>
                {visibleAlbums.map((album) => (
                  <SortableAlbumRow
                    key={album.id}
                    album={album}
                    reorderMode={reorderMode}
                    onSelectAlbum={onSelectAlbum}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </SortableContext>
            </div>
          </DndContext>
        </div>
      )}

      {showCreate && (
        <CreateAlbumModal
          orgId={orgId}
          onClose={() => setShowCreate(false)}
          onCreated={(album) => {
            setShowCreate(false);
            void fetchAlbums().then(() => onSelectAlbum(album));
          }}
        />
      )}
    </>
  );
}
