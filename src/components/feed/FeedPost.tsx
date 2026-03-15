"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { LikeButton } from "./LikeButton";
import { PostMedia } from "./PostMedia";
import { InlineComments } from "./InlineComments";
import { FeedPoll } from "./FeedPoll";
import { relativeTime } from "@/lib/utils/relative-time";
import type { PostWithAuthor } from "./types";

interface FeedPostProps {
  post: PostWithAuthor;
  orgSlug: string;
  currentUserId: string;
  isAdmin: boolean;
}

export function FeedPost({ post, orgSlug, currentUserId, isAdmin }: FeedPostProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count);

  const canDelete = post.author_id === currentUserId || isAdmin;
  const authorName = post.author?.name || "Unknown";

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
    <Card className="px-4 pt-4 pb-3 group">
      <div className="flex items-start gap-3">
        <Avatar name={authorName} size="sm" className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-semibold text-foreground leading-none truncate">{authorName}</span>
              <span className="text-xs text-muted-foreground/70 font-mono shrink-0">{relativeTime(post.created_at)}</span>
            </div>
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-all focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-label={isDeleting ? "Deleting post..." : "Delete post"}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            )}
          </div>
          {post.body && <p className="mt-1.5 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{post.body}</p>}
          {post.poll_meta && (
            <FeedPoll
              postId={post.id}
              meta={post.poll_meta}
              userVote={post.user_vote ?? null}
              voteCounts={post.vote_counts ?? []}
              totalVotes={post.total_votes ?? 0}
            />
          )}
          {post.media && post.media.length > 0 && (
            <PostMedia media={post.media} />
          )}
        </div>
      </div>
      {/* Interaction bar — full width, LinkedIn-style */}
      <div className="flex items-center mt-3 pt-2.5 border-t border-border/40">
        <LikeButton postId={post.id} likeCount={post.like_count} likedByUser={post.liked_by_user} />
        <button
          onClick={() => setIsCommentsOpen(!isCommentsOpen)}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label={`${commentCount} comments`}
          aria-expanded={isCommentsOpen}
          type="button"
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
          </svg>
          <span>Comment{commentCount > 0 ? ` (${commentCount})` : ""}</span>
        </button>
      </div>
      {/* Inline comments expansion */}
      {isCommentsOpen && (
        <InlineComments
          postId={post.id}
          commentCount={commentCount}
          currentUserId={currentUserId}
          orgSlug={orgSlug}
          onCountChange={setCommentCount}
        />
      )}
    </Card>
  );
}
