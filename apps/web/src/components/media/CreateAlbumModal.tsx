"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";
import type { MediaAlbum } from "./AlbumCard";

interface CreateAlbumModalProps {
  orgId: string;
  initialName?: string;
  onClose: () => void;
  onCreated: (album: MediaAlbum) => void;
}

export function CreateAlbumModal({ orgId, initialName = "", onClose, onCreated }: CreateAlbumModalProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/media/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create album");
      }
      const album = await res.json();
      onCreated(album);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create album");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-md mx-4 bg-card rounded-2xl border border-border shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">Create Album</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            ref={nameRef}
            label="Album name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Season 2024"
            maxLength={200}
            required
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Description (optional)</label>
            <textarea
              className="input min-h-[72px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="A short description of this album"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" isLoading={saving} disabled={!name.trim()}>
              Create
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
