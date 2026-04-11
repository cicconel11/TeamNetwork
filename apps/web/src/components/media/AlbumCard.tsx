"use client";

import Image from "next/image";
import { GripVertical } from "lucide-react";
import { UserContent } from "@/components/i18n/UserContent";
import { Card } from "@/components/ui";

export interface MediaAlbum {
  id: string;
  name: string;
  description?: string | null;
  cover_media_id?: string | null;
  cover_url?: string | null;
  item_count: number;
  sort_order?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  import_status?: "creating_album" | "waiting_for_uploads" | "adding_items" | "partial_success" | "success" | "failed";
  import_expected_count?: number;
  import_uploaded_count?: number;
  import_failed_count?: number;
}

interface AlbumCardProps {
  album: MediaAlbum;
  onClick: () => void;
  /** When true, navigation is disabled and a drag handle is shown (listeners on the handle only). */
  reorderMode?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}

export function AlbumCard({ album, onClick, reorderMode = false, dragHandleProps, isDragging = false }: AlbumCardProps) {
  const importLabel = getAlbumImportLabel(album);

  return (
    <Card
      interactive={!reorderMode}
      padding="none"
      className={`group overflow-hidden ${isDragging ? "ring-2 ring-[var(--color-org-secondary)] shadow-xl" : ""}`}
      onClick={reorderMode ? undefined : onClick}
    >
      {/* Cover image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {reorderMode && dragHandleProps && (
          <button
            type="button"
            className="absolute left-2 top-2 z-10 p-2 rounded-lg bg-background/90 backdrop-blur-sm border border-border shadow-sm text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
            aria-label={`Drag to reorder ${album.name}`}
            onClick={(e) => e.stopPropagation()}
            {...dragHandleProps}
          >
            <GripVertical className="w-5 h-5" aria-hidden />
          </button>
        )}
        {album.cover_url ? (
          <Image
            src={album.cover_url}
            alt={album.name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <AlbumPlaceholder />
        )}

        {importLabel && !reorderMode && (
          <div className="absolute right-2 top-2 z-10 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm">
            {importLabel}
          </div>
        )}

        {/* Overlay with name + count */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
          <UserContent as="p" className="text-sm font-semibold text-white truncate">
            {album.name}
          </UserContent>
          <p className="text-xs text-white/70 mt-0.5">
            {album.item_count} {album.item_count === 1 ? "photo" : "photos"}
          </p>
        </div>
      </div>
    </Card>
  );
}

function getAlbumImportLabel(album: MediaAlbum): string | null {
  switch (album.import_status) {
    case "creating_album":
      return "Starting import";
    case "waiting_for_uploads":
    case "adding_items":
      if (typeof album.import_expected_count === "number" && album.import_expected_count > 0) {
        return `Importing ${album.import_uploaded_count ?? 0}/${album.import_expected_count}`;
      }
      return "Importing";
    case "partial_success":
      return "Partially imported";
    case "failed":
      return "Import failed";
    default:
      return null;
  }
}

function AlbumPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
      <svg
        className="w-12 h-12 opacity-20"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M2.25 18.75h19.5a2.25 2.25 0 002.25-2.25V7.5a2.25 2.25 0 00-2.25-2.25H2.25A2.25 2.25 0 000 7.5v9a2.25 2.25 0 002.25 2.25z"
        />
      </svg>
    </div>
  );
}
