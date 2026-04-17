import type { SupabaseClient } from "@supabase/supabase-js";
import type { Announcement, MembershipStatus } from "@/types/database";
import type { OrgRole } from "./auth/role-utils";

export type AnnouncementViewerContext = {
  role: OrgRole | null;
  status: MembershipStatus | null;
  userId: string | null;
};

const isActive = (status: MembershipStatus | null) => status !== "revoked";

/** Mirrors public.can_view_announcement (keep in sync with migration). */
const canViewAnnouncement = (announcement: Announcement, ctx: AnnouncementViewerContext) => {
  if (!ctx.role || !isActive(ctx.status)) return false;
  if (ctx.role === "admin") return true;

  switch (announcement.audience) {
    case "all":
      return true;
    case "members":
    case "active_members":
      return ctx.role === "active_member" || ctx.role === "parent";
    case "alumni":
      return ctx.role === "alumni" || ctx.role === "parent";
    case "individuals":
      return !!ctx.userId && (announcement.audience_user_ids || []).includes(ctx.userId);
    default:
      return false;
  }
};

export function filterAnnouncementsForUser(
  announcements: Announcement[] | null | undefined,
  ctx: AnnouncementViewerContext,
) {
  if (!announcements || announcements.length === 0) return [];
  return announcements.filter((announcement) => canViewAnnouncement(announcement, ctx));
}

/**
 * Server-side visibility using the reconciled SQL predicate (single source of truth).
 * Falls back to {@link filterAnnouncementsForUser} if the RPC is unavailable.
 */
export async function filterAnnouncementsForUserViaRpc(
  supabase: SupabaseClient,
  orgId: string,
  announcements: Announcement[] | null | undefined,
  fallbackCtx: AnnouncementViewerContext,
): Promise<Announcement[]> {
  if (!announcements || announcements.length === 0) return [];
  const ids = announcements.map((a) => a.id);
  const { data, error } = await supabase.rpc("filter_announcement_ids_for_user", {
    p_org_id: orgId,
    p_announcement_ids: ids,
  });
  if (error || !Array.isArray(data)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[announcements] filter_announcement_ids_for_user failed, using TS filter", error);
    }
    return filterAnnouncementsForUser(announcements, fallbackCtx);
  }
  const allowed = new Set(data as string[]);
  return announcements.filter((a) => allowed.has(a.id));
}
