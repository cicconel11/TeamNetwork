"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { MediaAlbum } from "./AlbumCard";

interface AlbumPickerModalProps {
  orgId: string;
  mediaIds: string[];
  onClose: () => void;
  onSuccess: (albumId: string, albumName: string) => void;
}

export function AlbumPickerModal({ orgId, mediaIds, onClose, onSuccess }: AlbumPickerModalProps) {
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [showNewAlbum, setShowNewAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const newAlbumInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/media/albums?orgId=${orgId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setAlbums(data.data || []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load albums");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [orgId]);

  useEffect(() => {
    if (showNewAlbum) {
      setTimeout(() => newAlbumInputRef.current?.focus(), 50);
    }
  }, [showNewAlbum]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    setSubmitting(true);
    setError(null);

    try {
      let albumId: string;
      let albumName: string;

      if (showNewAlbum) {
        const name = newAlbumName.trim();
        if (!name) {
          setError("Album name is required");
          setSubmitting(false);
          return;
        }
        // Create new album
        const createRes = await fetch("/api/media/albums", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, name }),
        });
        if (!createRes.ok) {
          const data = await createRes.json().catch(() => null);
          throw new Error(data?.error || "Failed to create album");
        }
        const created: MediaAlbum = await createRes.json();
        albumId = created.id;
        albumName = created.name;
      } else {
        if (!selectedAlbumId) {
          setError("Select an album or create a new one");
          setSubmitting(false);
          return;
        }
        const found = albums.find((a) => a.id === selectedAlbumId);
        albumId = selectedAlbumId;
        albumName = found?.name || "";
      }

      // Add items to album
      const addRes = await fetch(`/api/media/albums/${albumId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, mediaIds }),
      });
      if (!addRes.ok) {
        const data = await addRes.json().catch(() => null);
        throw new Error(data?.error || "Failed to add photos to album");
      }

      onSuccess(albumId, albumName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }, [showNewAlbum, newAlbumName, selectedAlbumId, albums, orgId, mediaIds, onSuccess]);

  const isReady = showNewAlbum ? newAlbumName.trim().length > 0 : selectedAlbumId !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[400px] flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Add to album</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {mediaIds.length} {mediaIds.length === 1 ? "photo" : "photos"} selected
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-[var(--muted)] flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-[var(--foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 rounded-xl bg-[var(--muted)] animate-pulse" />
              ))}
            </div>
          )}

          {!loading && albums.length === 0 && !showNewAlbum && (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">
              No albums yet. Create one below.
            </p>
          )}

          {!loading && albums.map((album) => (
            <button
              key={album.id}
              onClick={() => {
                setSelectedAlbumId(album.id);
                setShowNewAlbum(false);
              }}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                selectedAlbumId === album.id && !showNewAlbum
                  ? "bg-[var(--color-org-secondary)]/10 border border-[var(--color-org-secondary)]/30"
                  : "hover:bg-[var(--muted)] border border-transparent"
              }`}
            >
              {/* Album cover or icon */}
              <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-[var(--muted)] flex items-center justify-center">
                {album.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={album.cover_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-4 h-4 text-[var(--muted-foreground)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M2.25 18.75h19.5a2.25 2.25 0 002.25-2.25V7.5a2.25 2.25 0 00-2.25-2.25H2.25A2.25 2.25 0 000 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--foreground)] truncate">{album.name}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {album.item_count} {album.item_count === 1 ? "photo" : "photos"}
                </p>
              </div>
              {selectedAlbumId === album.id && !showNewAlbum && (
                <svg className="w-4 h-4 text-[var(--color-org-secondary)] shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}

          {/* New album row */}
          {!loading && (
            <div>
              {showNewAlbum ? (
                <div className="rounded-xl border border-[var(--color-org-secondary)]/30 bg-[var(--color-org-secondary)]/5 px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-[var(--color-org-secondary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span className="text-sm font-medium text-[var(--foreground)]">New album</span>
                  </div>
                  <input
                    ref={newAlbumInputRef}
                    className="w-full text-sm bg-transparent border-b border-[var(--border)] focus:border-[var(--color-org-secondary)] outline-none pb-1 text-[var(--foreground)] placeholder-[var(--muted-foreground)]"
                    placeholder="Album name"
                    value={newAlbumName}
                    onChange={(e) => setNewAlbumName(e.target.value)}
                    maxLength={200}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && isReady) handleConfirm();
                    }}
                  />
                  <button
                    onClick={() => { setShowNewAlbum(false); setNewAlbumName(""); }}
                    className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowNewAlbum(true); setSelectedAlbumId(null); }}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--muted)] border border-dashed border-[var(--border)] transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-[var(--muted)] flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-[var(--muted-foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </div>
                  <span className="text-sm text-[var(--muted-foreground)]">Create new album</span>
                </button>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] shrink-0">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!isReady || submitting}
            isLoading={submitting}
          >
            {showNewAlbum ? "Create & add" : "Add to album"}
          </Button>
        </div>
      </div>
    </div>
  );
}
