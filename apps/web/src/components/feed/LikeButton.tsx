"use client";

import { useState } from "react";

interface LikeButtonProps {
  postId: string;
  likeCount: number;
  likedByUser: boolean;
}

export function LikeButton({ postId, likeCount: initialCount, likedByUser: initialLiked }: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [isLoading, setIsLoading] = useState(false);

  const toggle = async () => {
    if (isLoading) return;

    // Optimistic update
    const wasLiked = liked;
    setLiked(!liked);
    setCount((c) => (wasLiked ? c - 1 : c + 1));
    setIsLoading(true);

    try {
      const response = await fetch(`/api/feed/${postId}/like`, {
        method: "POST",
      });

      if (!response.ok) {
        setLiked(wasLiked);
        setCount((c) => (wasLiked ? c + 1 : c - 1));
      }
    } catch {
      setLiked(wasLiked);
      setCount((c) => (wasLiked ? c + 1 : c - 1));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={isLoading}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all duration-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-95"
      type="button"
      aria-label={liked ? "Unlike post" : "Like post"}
      aria-pressed={liked}
    >
      {liked ? (
        <svg className="h-3.5 w-3.5 text-rose-500 fill-current" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      )}
      <span className="font-mono">{count}</span>
    </button>
  );
}
