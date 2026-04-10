"use client";

interface MessageLikeButtonProps {
  count: number;
  liked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label?: string;
}

export function MessageLikeButton({
  count,
  liked,
  disabled = false,
  onToggle,
  label = "message",
}: MessageLikeButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={liked ? `Unlike ${label}` : `Like ${label}`}
      aria-pressed={liked}
      className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {liked ? (
        <svg className="h-3.5 w-3.5 fill-rose-500 text-rose-500" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      )}
      <span className="font-medium">{count}</span>
    </button>
  );
}
