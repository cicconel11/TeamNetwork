import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FeedPost } from "./FeedPost";
import type { PostWithAuthor } from "./types";

interface FeedListProps {
  posts: PostWithAuthor[];
  orgSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  canPost?: boolean;
  basePath?: string;
  pagination?: {
    page: number;
    total: number;
    totalPages: number;
  };
}

export async function FeedList({ posts, orgSlug, currentUserId, isAdmin, canPost, basePath, pagination }: FeedListProps) {
  if (posts.length === 0) {
    const t = await getTranslations("pages.feed");
    return (
      <EmptyState
        icon={<MessageSquarePlus className="h-12 w-12" />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        action={
          canPost ? (
            <Link href="?compose=1">
              <Button>{t("emptyCta")}</Button>
            </Link>
          ) : undefined
        }
      />
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
      {pagination && pagination.totalPages > 1 && (() => {
        const base = basePath || `/${orgSlug}/feed`;
        return (
          <div className="flex justify-center gap-2 pt-4">
            {pagination.page > 1 && (
              <Link href={`${base}?page=${pagination.page - 1}`}>
                <Button variant="ghost" size="sm">
                  Previous
                </Button>
              </Link>
            )}
            <span className="text-sm text-muted-foreground self-center">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            {pagination.page < pagination.totalPages && (
              <Link href={`${base}?page=${pagination.page + 1}`}>
                <Button variant="ghost" size="sm">
                  Next
                </Button>
              </Link>
            )}
          </div>
        );
      })()}
    </div>
  );
}
