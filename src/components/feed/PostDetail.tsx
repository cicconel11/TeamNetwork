"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserContent } from "@/components/i18n/UserContent";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LikeButton } from "./LikeButton";
import { PostMedia } from "./PostMedia";
import type { PostWithAuthor } from "./types";

interface PostDetailProps {
  post: PostWithAuthor;
  orgSlug: string;
  currentUserId: string;
  isAdmin: boolean;
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PostDetail({ post, orgSlug, currentUserId, isAdmin }: PostDetailProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const canDelete = post.author_id === currentUserId || isAdmin;

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this post?")) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/feed/${post.id}`, { method: "DELETE" });
      if (response.ok) {
        router.push(`/${orgSlug}/feed`);
      }
    } catch {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            <UserContent>{post.author?.name || "Unknown"}</UserContent>
          </span>
          {" · "}
          {formatDateTime(post.created_at)}
        </div>
        {canDelete && (
          <Button onClick={handleDelete} disabled={isDeleting} variant="ghost" size="sm">
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
      <div className="prose max-w-none">
        <UserContent as="p" className="whitespace-pre-wrap text-foreground">
          {post.body}
        </UserContent>
      </div>
      {post.media && post.media.length > 0 && (
        <PostMedia media={post.media} />
      )}
      <div className="mt-4 flex items-center gap-4">
        <LikeButton postId={post.id} likeCount={post.like_count} likedByUser={post.liked_by_user} />
        <span className="text-sm text-muted-foreground">
          {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
        </span>
      </div>
    </Card>
  );
}
