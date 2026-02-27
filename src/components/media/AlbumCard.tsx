"use client";

import Image from "next/image";
import { Card } from "@/components/ui";

export interface MediaAlbum {
  id: string;
  name: string;
  description?: string | null;
  cover_media_id?: string | null;
  cover_url?: string | null;
  item_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AlbumCardProps {
  album: MediaAlbum;
  onClick: () => void;
}

export function AlbumCard({ album, onClick }: AlbumCardProps) {
  return (
    <Card
      interactive
      padding="none"
      className="group overflow-hidden"
      onClick={onClick}
    >
      {/* Cover image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
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

        {/* Overlay with name + count */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
          <p className="text-sm font-semibold text-white truncate">{album.name}</p>
          <p className="text-xs text-white/70 mt-0.5">
            {album.item_count} {album.item_count === 1 ? "photo" : "photos"}
          </p>
        </div>
      </div>
    </Card>
  );
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
