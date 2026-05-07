"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui";
import type { MediaItem } from "./MediaCard";

interface CoverPickerModalProps {
  items: MediaItem[];
  currentCoverId: string | null;
  onSelect: (mediaId: string, coverUrl: string) => void;
  onClose: () => void;
  saving: boolean;
}

export function CoverPickerModal({
  items,
  currentCoverId,
  onSelect,
  onClose,
  saving,
}: CoverPickerModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(currentCoverId);

  const selectedItem = items.find((i) => i.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            Set album cover
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-[var(--muted)] flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-[var(--foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
              No images in this album to use as a cover.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    selectedId === item.id
                      ? "border-[var(--color-org-secondary)] ring-2 ring-[var(--color-org-secondary)]/30"
                      : "border-transparent hover:border-[var(--border)]"
                  }`}
                >
                  {item.thumbnail_url || item.url ? (
                    <Image
                      src={item.thumbnail_url || item.url!}
                      alt={item.title}
                      fill
                      className="object-cover"
                      sizes="120px"
                    />
                  ) : (
                    <div className="w-full h-full bg-[var(--muted)]" />
                  )}
                  {selectedId === item.id && (
                    <div className="absolute inset-0 bg-[var(--color-org-secondary)]/20 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {currentCoverId === item.id && selectedId !== item.id && (
                    <div className="absolute top-1 left-1">
                      <span className="text-[10px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded">
                        Current
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              isLoading={saving}
              disabled={!selectedId || selectedId === currentCoverId}
              onClick={() => {
                if (selectedId && selectedItem) {
                  onSelect(selectedId, selectedItem.url || selectedItem.thumbnail_url || "");
                }
              }}
            >
              Set as cover
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
