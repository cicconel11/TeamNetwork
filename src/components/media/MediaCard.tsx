"use client";

import Image from "next/image";
import { Card, Badge } from "@/components/ui";
import { getCardDisplayUrl } from "@/lib/media/display-url";

export { getCardDisplayUrl };

export interface MediaItem {
  id: string;
  title: string;
  description?: string | null;
  media_type: "image" | "video";
  url: string | null;
  thumbnail_url: string | null;
  external_url?: string | null;
  tags: string[];
  taken_at?: string | null;
  created_at: string;
  uploaded_by: string;
  status: string;
  users?: { name: string | null } | null;
}

interface MediaCardProps {
  item: MediaItem;
  onClick: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}

export function MediaCard({ item, onClick, selectable, selected, onToggle }: MediaCardProps) {
  const displayUrl = getCardDisplayUrl(item);
  const uploaderName = item.users?.name || "Unknown";
  const displayDate = item.taken_at
    ? new Date(item.taken_at).toLocaleDateString()
    : new Date(item.created_at).toLocaleDateString();

  const handleClick = () => {
    if (selectable) {
      onToggle?.();
    } else {
      onClick();
    }
  };

  return (
    <Card
      interactive
      padding="none"
      className={`group overflow-hidden transition-all duration-150 ${
        selected
          ? "ring-2 ring-[var(--color-org-secondary)] ring-offset-1 scale-[0.97]"
          : ""
      }`}
      onClick={handleClick}
    >
      {/* Image/Video container */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {item.media_type === "video" && !displayUrl ? (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-700 to-slate-900">
            <VideoPlaceholderIcon />
          </div>
        ) : displayUrl ? (
          <Image
            src={displayUrl}
            alt={item.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <ImagePlaceholderIcon />
          </div>
        )}

        {/* Selection checkbox */}
        {selectable && (
          <div
            className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
              selected
                ? "bg-[var(--color-org-secondary)] border-[var(--color-org-secondary)]"
                : "bg-white/80 border-[var(--border)] backdrop-blur-sm opacity-0 group-hover:opacity-100"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
          >
            {selected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        {/* Video overlay */}
        {item.media_type === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
              <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

        {/* Status badge for non-approved items */}
        {item.status !== "approved" && (
          <div className={`absolute top-2 ${selectable ? "left-9" : "left-2"}`}>
            <Badge variant={item.status === "pending" ? "warning" : "muted"}>
              {item.status}
            </Badge>
          </div>
        )}

        {/* Video type badge */}
        {item.media_type === "video" && (
          <div className="absolute top-2 right-2">
            <Badge variant="muted">Video</Badge>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{uploaderName}</span>
          <span className="shrink-0">{displayDate}</span>
        </div>
        {item.tags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-hidden">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-block px-2 py-0.5 text-[10px] font-medium rounded-full bg-muted text-muted-foreground truncate max-w-[80px]"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{item.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function VideoPlaceholderIcon() {
  return (
    <svg className="w-12 h-12 text-slate-400 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function ImagePlaceholderIcon() {
  return (
    <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M2.25 18.75h19.5a2.25 2.25 0 0 0 2.25-2.25V7.5a2.25 2.25 0 0 0-2.25-2.25H2.25A2.25 2.25 0 0 0 0 7.5v9a2.25 2.25 0 0 0 2.25 2.25Zm4.5-10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
    </svg>
  );
}
