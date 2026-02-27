"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ui";
import { AlbumCard, type MediaAlbum } from "./AlbumCard";
import { CreateAlbumModal } from "./CreateAlbumModal";

interface AlbumGridProps {
  orgId: string;
  canCreate: boolean;
  onSelectAlbum: (album: MediaAlbum) => void;
}

export function AlbumGrid({ orgId, canCreate, onSelectAlbum }: AlbumGridProps) {
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchAlbums = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/albums?orgId=${encodeURIComponent(orgId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to load albums");
      }
      const result = await res.json();
      setAlbums(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load albums");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchAlbums();
  }, [fetchAlbums]);

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
        <button onClick={fetchAlbums} className="ml-2 underline">Retry</button>
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
          title="No albums yet"
          description="Albums let you group photos and videos together."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Create album card */}
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="group relative aspect-[4/3] rounded-xl border-2 border-dashed border-border hover:border-muted-foreground transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <div className="w-12 h-12 rounded-full border-2 border-current flex items-center justify-center transition-transform group-hover:scale-110">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <span className="text-sm font-medium">New Album</span>
            </button>
          )}

          {albums.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              onClick={() => onSelectAlbum(album)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateAlbumModal
          orgId={orgId}
          onClose={() => setShowCreate(false)}
          onCreated={(album) => {
            setAlbums((prev) => [album, ...prev]);
            setShowCreate(false);
            onSelectAlbum(album);
          }}
        />
      )}
    </>
  );
}
