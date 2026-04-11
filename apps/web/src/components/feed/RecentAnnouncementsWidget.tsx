import Link from "next/link";
import { Card } from "@/components/ui/Card";

interface AnnouncementSummary {
  id: string;
  title: string;
  body: string | null;
  published_at: string | null;
}

interface RecentAnnouncementsWidgetProps {
  announcements: AnnouncementSummary[];
  orgSlug: string;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RecentAnnouncementsWidget({ announcements, orgSlug }: RecentAnnouncementsWidgetProps) {
  if (announcements.length === 0) {
    return (
      <Card interactive padding="md">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Announcements</h3>
        <p className="text-sm text-muted-foreground/60 mt-3">No recent announcements</p>
      </Card>
    );
  }

  return (
    <Card interactive padding="md">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Announcements</h3>
      <ul className="space-y-3 mt-3 stagger-children">
        {announcements.map((announcement) => (
          <li key={announcement.id}>
            <Link
              href={`/${orgSlug}/announcements`}
              className="block p-2 -m-2 rounded-xl hover:bg-muted transition-all duration-200"
            >
              <p className="text-sm font-semibold text-foreground line-clamp-1">{announcement.title}</p>
              {announcement.body && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{announcement.body}</p>
              )}
              {announcement.published_at && (
                <span className="text-[11px] text-muted-foreground/70 mt-1 block">{formatDate(announcement.published_at)}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={`/${orgSlug}/announcements`}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-org-secondary mt-3 pt-3 border-t border-border transition-colors duration-200"
      >
        See all announcements <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}
