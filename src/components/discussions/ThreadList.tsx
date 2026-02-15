import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Database } from "@/types/database";

type ThreadWithAuthor = Database["public"]["Tables"]["discussion_threads"]["Row"] & {
  author: { name: string } | null;
};

interface ThreadListProps {
  threads: ThreadWithAuthor[];
  orgSlug: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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

export function ThreadList({ threads, orgSlug, pagination }: ThreadListProps) {
  if (threads.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No discussions yet. Start the conversation!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {threads.map((thread) => (
        <Card key={thread.id} className="p-4 hover:shadow-md transition-shadow">
          <Link href={`/${orgSlug}/discussions/${thread.id}`} className="block">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {thread.is_pinned && (
                    <svg className="h-4 w-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L11 4.323V3a1 1 0 011-1zm-5 8.274l-.818 2.552c-.25.78.409 1.547 1.204 1.547.468 0 .906-.218 1.187-.567l.612-.757a1 1 0 011.54 1.281l-.612.757a3.989 3.989 0 01-2.727 1.286c-1.98 0-3.42-1.837-2.82-3.539l.818-2.552a1 1 0 011.886.632z" />
                    </svg>
                  )}
                  {thread.is_locked && (
                    <svg className="h-4 w-4 text-muted-foreground flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  <h3 className="font-semibold text-foreground truncate">{thread.title}</h3>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{thread.author?.name || "Unknown"}</span>
                  <span>•</span>
                  <span>{formatRelativeTime(thread.last_activity_at)}</span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {thread.reply_count > 0 && (
                  <Badge variant="muted">
                    {thread.reply_count} {thread.reply_count === 1 ? "reply" : "replies"}
                  </Badge>
                )}
              </div>
            </div>
          </Link>
        </Card>
      ))}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          {pagination.page > 1 && (
            <Link href={`/${orgSlug}/discussions?page=${pagination.page - 1}`}>
              <Button variant="ghost" size="sm">
                Previous
              </Button>
            </Link>
          )}
          <span className="text-sm text-muted-foreground self-center">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.page < pagination.totalPages && (
            <Link href={`/${orgSlug}/discussions?page=${pagination.page + 1}`}>
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
