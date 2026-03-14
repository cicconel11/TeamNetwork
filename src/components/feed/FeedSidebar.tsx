import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/roles";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import { filterAnnouncementsForUser } from "@/lib/announcements";
import { UpcomingEventsWidget } from "./UpcomingEventsWidget";
import { RecentAnnouncementsWidget } from "./RecentAnnouncementsWidget";
import { MemberHighlightsWidget } from "./MemberHighlightsWidget";
import type { OrgRole } from "@/lib/auth/role-utils";
import type { Announcement, MembershipStatus } from "@/types/database";

interface FeedSidebarProps {
  orgSlug: string;
  orgId: string;
  role: OrgRole | null;
  status: string | null;
  userId: string | null;
  isDevAdmin: boolean;
}

export async function FeedSidebar({ orgSlug, orgId, role, status, userId }: FeedSidebarProps) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  const queryClient = resolveDataClient(user, supabase, "view_org");

  const [
    { data: upcomingEvents },
    { data: recentAnnouncements },
    { data: newMembers },
  ] = await Promise.all([
    queryClient
      .from("events")
      .select("id, title, start_date")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .gte("start_date", new Date().toISOString())
      .order("start_date")
      .limit(3),
    queryClient
      .from("announcements")
      .select("id, title, body, published_at, audience, audience_user_ids")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(5),
    queryClient
      .from("members")
      .select("id, first_name, last_name, photo_url, created_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const visibleAnnouncements = filterAnnouncementsForUser(
    recentAnnouncements as Announcement[] | null,
    { role, status: status as MembershipStatus | null, userId },
  ).slice(0, 3);

  return (
    <div className="space-y-4">
      <UpcomingEventsWidget events={upcomingEvents || []} orgSlug={orgSlug} />
      <RecentAnnouncementsWidget announcements={visibleAnnouncements} orgSlug={orgSlug} />
      <MemberHighlightsWidget members={newMembers || []} orgSlug={orgSlug} />
    </div>
  );
}
