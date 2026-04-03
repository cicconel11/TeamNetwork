import { createClient } from "@/lib/supabase/server";
import { filterAnnouncementsForUser } from "@/lib/announcements";
import type { OrgRole } from "@/lib/auth/role-utils";
import type { Announcement, MembershipStatus } from "@/types/database";

export interface FeedSidebarData {
  upcomingEvents: { id: string; title: string; start_date: string }[];
  visibleAnnouncements: Announcement[];
  newMembers: {
    id: string;
    first_name: string;
    last_name: string;
    photo_url: string | null;
    created_at: string | null;
  }[];
}

export async function loadFeedSidebarData(params: {
  orgId: string;
  role: OrgRole | null;
  status: string | null;
  userId: string | null;
}): Promise<FeedSidebarData> {
  const { orgId, role, status, userId } = params;
  const supabase = await createClient();

  const [
    { data: upcomingEvents, error: eventsError },
    { data: recentAnnouncements, error: announcementsError },
    { data: newMembers, error: membersError },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, start_date")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .gte("start_date", new Date().toISOString())
      .order("start_date")
      .limit(3),
    supabase
      .from("announcements")
      .select("id, title, body, published_at, audience, audience_user_ids")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("published_at", { ascending: false })
      .limit(5),
    supabase
      .from("members")
      .select("id, first_name, last_name, photo_url, created_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (eventsError) console.error("[loadFeedSidebarData] events query failed:", eventsError.message);
  if (announcementsError)
    console.error("[loadFeedSidebarData] announcements query failed:", announcementsError.message);
  if (membersError) console.error("[loadFeedSidebarData] members query failed:", membersError.message);

  const visibleAnnouncements = filterAnnouncementsForUser(
    recentAnnouncements as Announcement[] | null,
    { role, status: status as MembershipStatus | null, userId },
  ).slice(0, 3);

  return {
    upcomingEvents: (upcomingEvents || []) as FeedSidebarData["upcomingEvents"],
    visibleAnnouncements,
    newMembers: newMembers || [],
  };
}
