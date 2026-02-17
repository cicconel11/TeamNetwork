import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { FeedPost } from "./FeedPost";
import type { Database } from "@/types/database";

type PostWithAuthor = Database["public"]["Tables"]["feed_posts"]["Row"] & {
  author: { name: string } | null;
  liked_by_user: boolean;
};

interface FeedListProps {
  posts: PostWithAuthor[];
  orgSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function FeedList({ posts, orgSlug, currentUserId, isAdmin, pagination }: FeedListProps) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No posts yet. Be the first to share something!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <FeedPost
          key={post.id}
          post={post}
          orgSlug={orgSlug}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      ))}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          {pagination.page > 1 && (
            <Link href={`/${orgSlug}/feed?page=${pagination.page - 1}`}>
              <Button variant="ghost" size="sm">
                Previous
              </Button>
            </Link>
          )}
          <span className="text-sm text-muted-foreground self-center">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.page < pagination.totalPages && (
            <Link href={`/${orgSlug}/feed?page=${pagination.page + 1}`}>
              <Button variant="ghost" size="sm">
                Next
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
