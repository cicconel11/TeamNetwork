import Link from "next/link";
import { UserContent } from "@/components/i18n/UserContent";
import { Card, Badge, Button, SoftDeleteButton } from "@/components/ui";
import { MegaphoneIcon } from "./icons";
import type { Database } from "@/types/database";

type Announcement = Database["public"]["Tables"]["announcements"]["Row"];

interface AnnouncementCardProps {
  announcement: Announcement;
  orgSlug: string;
  isAdmin: boolean;
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "Scheduled";
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function AnnouncementCard({
  announcement,
  orgSlug,
  isAdmin,
}: AnnouncementCardProps) {
  const isPinned = announcement.is_pinned;

  const cardClassName = isPinned
    ? "p-6 border-l-4 border-l-green-500"
    : "p-6";

  const iconClassName = isPinned
    ? "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-green-100 dark:bg-green-900/30"
    : "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-muted";

  const iconColorClassName = isPinned
    ? "h-5 w-5 text-green-600 dark:text-green-400"
    : "h-5 w-5 text-muted-foreground";

  return (
    <Card className={cardClassName}>
      <div className="flex items-start gap-4">
        {/* Megaphone icon badge */}
        <div className={iconClassName}>
          <MegaphoneIcon className={iconColorClassName} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Top row: date/time + badges + admin actions */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {formatDateTime(announcement.published_at)}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isPinned && <Badge variant="success">Pinned</Badge>}
              {isAdmin && (
                <>
                  <Link href={`/${orgSlug}/announcements/${announcement.id}/edit`}>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </Link>
                  <SoftDeleteButton
                    table="announcements"
                    id={announcement.id}
                    organizationField="organization_id"
                    organizationId={announcement.organization_id}
                    redirectTo={`/${orgSlug}/announcements`}
                    label="Delete"
                  />
                </>
              )}
            </div>
          </div>

          {/* Title */}
          <UserContent as="h3" className="text-base font-semibold text-foreground mt-1">
            {announcement.title}
          </UserContent>

          {/* Body preview */}
          {announcement.body && (
            <UserContent as="p" className="text-muted-foreground mt-2 line-clamp-3 whitespace-pre-wrap">
              {announcement.body}
            </UserContent>
          )}
        </div>
      </div>
    </Card>
  );
}
