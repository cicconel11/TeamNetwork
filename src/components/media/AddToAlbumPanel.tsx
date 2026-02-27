"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { MediaAlbum } from "./AlbumCard";

interface AddToAlbumPanelProps {
  mediaId: string;
  orgId: string;
  canManage: boolean;
}

export function AddToAlbumPanel({ mediaId, orgId, canManage }: AddToAlbumPanelProps) {
  const [allAlbums, setAllAlbums] = useState<MediaAlbum[]>([]);
  const [memberAlbumIds, setMemberAlbumIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allRes, memberRes] = await Promise.all([
        fetch(`/api/media/albums?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/media/albums?orgId=${encodeURIComponent(orgId)}&containsItemId=${encodeURIComponent(mediaId)}`),
      ]);
      const allData = allRes.ok ? await allRes.json() : { data: [] };
      const memberData = memberRes.ok ? await memberRes.json() : { data: [] };
      setAllAlbums(allData.data || []);
      setMemberAlbumIds(new Set((memberData.data || []).map((a: MediaAlbum) => a.id)));
    } catch {
      // Silently fail — panel is non-critical
    } finally {
      setLoading(false);
    }
  }, [mediaId, orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const memberAlbums = allAlbums.filter((a) => memberAlbumIds.has(a.id));
  const nonMemberAlbums = allAlbums.filter((a) => !memberAlbumIds.has(a.id));

  const addToAlbum = async (albumId: string) => {
    setBusy(albumId);
    try {
      const res = await fetch(`/api/media/albums/${albumId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, mediaIds: [mediaId] }),
      });
      if (res.ok) {
        setMemberAlbumIds((prev) => new Set([...prev, albumId]));
      }
    } catch {
      // Silently fail
    } finally {
      setBusy(null);
      setShowPicker(false);
    }
  };

  const removeFromAlbum = async (albumId: string) => {
    setBusy(albumId);
    try {
      const res = await fetch(
        `/api/media/albums/${albumId}/items/${mediaId}?orgId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setMemberAlbumIds((prev) => {
          const next = new Set(prev);
          next.delete(albumId);
          return next;
        });
      }
    } catch {
      // Silently fail
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-1.5">
        <span className="text-muted-foreground text-sm">Albums</span>
        <div className="h-3 w-24 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  // If there are no albums and user can't manage, don't show the panel
  if (allAlbums.length === 0 && !canManage) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Albums</span>
        {canManage && allAlbums.length > 0 && nonMemberAlbums.length > 0 && (
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-xs text-[var(--color-org-secondary)] hover:underline font-medium"
          >
            Add to album
          </button>
        )}
      </div>

      {/* Current albums this item belongs to */}
      {memberAlbums.length > 0 ? (
        <div className="space-y-1">
          {memberAlbums.map((album) => (
            <div key={album.id} className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-sm text-foreground truncate">{album.name}</span>
              {canManage && (
                <button
                  onClick={() => removeFromAlbum(album.id)}
                  disabled={busy === album.id}
                  className="shrink-0 text-xs text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                  aria-label={`Remove from ${album.name}`}
                >
                  {busy === album.id ? "..." : "×"}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Not in any album yet.</p>
      )}

      {/* Album picker */}
      {showPicker && nonMemberAlbums.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden mt-1">
          {nonMemberAlbums.map((album) => (
            <button
              key={album.id}
              onClick={() => addToAlbum(album.id)}
              disabled={busy === album.id}
              className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors flex items-center justify-between gap-2 disabled:opacity-50"
            >
              <span className="truncate">{album.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {busy === album.id ? "Adding..." : `${album.item_count} items`}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Offer to add to album if user can manage but no picker shown */}
      {canManage && !showPicker && allAlbums.length > 0 && nonMemberAlbums.length > 0 && memberAlbums.length === 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowPicker(true)}
        >
          Add to album
        </Button>
      )}
    </div>
  );
}
