import Link from "next/link";
import { Megaphone } from "lucide-react";
import { getTranslations } from "next-intl/server";
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

export async function RecentAnnouncementsWidget({ announcements, orgSlug }: RecentAnnouncementsWidgetProps) {
  const t = await getTranslations("pages.feed");
  if (announcements.length === 0) {
    return (
      <Card className="rounded-xl border-border/70 bg-card/75 p-4 shadow-none backdrop-blur-sm">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{t("announcementsTitle")}</h3>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground/60">
          <Megaphone className="h-4 w-4 shrink-0" />
          <span>{t("announcementsEmpty")}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-border/70 bg-card/75 p-4 shadow-none backdrop-blur-sm">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{t("announcementsTitle")}</h3>
      <ul className="space-y-3 mt-3 stagger-children">
        {announcements.map((announcement) => (
          <li key={announcement.id}>
            <Link
              href={`/${orgSlug}/announcements`}
              className="-m-2 block rounded-lg p-2 transition-all duration-200 hover:bg-muted/35"
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
        className="mt-3 flex items-center gap-1 border-t border-border/40 pt-3 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        {t("announcementsSeeAll")} <span aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}
