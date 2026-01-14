import type { Announcement, MembershipStatus } from "@teammeet/types";
import type { OrgRole } from "../auth/role-utils";

/**
 * Context for determining announcement visibility.
 */
export type ViewerContext = {
  role: OrgRole | null;
  status: MembershipStatus | null;
  userId: string | null;
};

const isActive = (status: MembershipStatus | null) => status !== "revoked";

const canViewAnnouncement = (announcement: Announcement, ctx: ViewerContext) => {
  if (!ctx.role || !isActive(ctx.status)) return false;
  if (ctx.role === "admin") return true;

  switch (announcement.audience) {
    case "all":
      return true;
    case "members":
    case "active_members":
      return ctx.role === "active_member";
    case "alumni":
      return ctx.role === "alumni";
    case "individuals":
      return !!ctx.userId && (announcement.audience_user_ids || []).includes(ctx.userId);
    default:
      return false;
  }
};

/**
 * Filters announcements based on user role and audience targeting.
 */
export function filterAnnouncementsForUser(
  announcements: Announcement[] | null | undefined,
  ctx: ViewerContext
): Announcement[] {
  if (!announcements || announcements.length === 0) return [];
  return announcements.filter((announcement) => canViewAnnouncement(announcement, ctx));
}
