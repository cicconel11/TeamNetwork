import { UpcomingEventsWidget } from "./UpcomingEventsWidget";
import { RecentAnnouncementsWidget } from "./RecentAnnouncementsWidget";
import { MemberHighlightsWidget } from "./MemberHighlightsWidget";
import type { FeedSidebarData } from "@/lib/feed/load-feed-sidebar-data";

interface FeedSidebarWidgetsProps {
  orgSlug: string;
  data: FeedSidebarData;
}

/** Renders feed sidebar blocks from preloaded data (single query path on org home). */
export function FeedSidebarWidgets({ orgSlug, data }: FeedSidebarWidgetsProps) {
  return (
    <div className="space-y-4">
      <UpcomingEventsWidget events={data.upcomingEvents} orgSlug={orgSlug} />
      <RecentAnnouncementsWidget announcements={data.visibleAnnouncements} orgSlug={orgSlug} />
      <MemberHighlightsWidget members={data.newMembers} orgSlug={orgSlug} />
    </div>
  );
}
