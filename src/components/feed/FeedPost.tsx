"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LikeButton } from "./LikeButton";
import type { Database } from "@/types/database";

type PostWithAuthor = Database["public"]["Tables"]["feed_posts"]["Row"] & {
  author: { name: string } | null;
  liked_by_user: boolean;
};

interface FeedPostProps {
  post: PostWithAuthor;
  orgSlug: string;
  currentUserId: string;
  isAdmin: boolean;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

export function FeedPost({ post, orgSlug, currentUserId, isAdmin }: FeedPostProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const canDelete = post.author_id === currentUserId || isAdmin;

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this post?")) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/feed/${post.id}`, { method: "DELETE" });
      if (response.ok) {
        router.refresh();
      }
    } catch {
      // Error handled silently
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{post.author?.name || "Unknown"}</span>
          <span>·</span>
          <span>{formatRelativeTime(post.created_at)}</span>
        </div>
        {canDelete && (
          <Button
            onClick={handleDelete}
            disabled={isDeleting}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-red-500"
          >
            {isDeleting ? "..." : "Delete"}
          </Button>
        )}
      </div>
      <div className="mt-2">
        <p className="whitespace-pre-wrap text-foreground">{post.body}</p>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <LikeButton postId={post.id} likeCount={post.like_count} likedByUser={post.liked_by_user} />
        <Link
          href={`/${orgSlug}/feed/${post.id}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
          </svg>
          <span>{post.comment_count}</span>
        </Link>
      </div>
    </Card>
  );
}
