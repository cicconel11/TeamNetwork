/**
 * Per-channel topics for announcement-related Supabase Realtime subscriptions.
 * Each mounted hook instance must pass a distinct `instanceKey` (e.g. from React `useId`)
 * so multiple components for the same org do not reuse one channel topic — Supabase
 * returns the existing channel by topic, and adding listeners after subscribe() throws.
 */

export function announcementsTableChannelTopic(orgId: string, instanceKey: string): string {
  return `announcements:${orgId}:${instanceKey}`;
}

export function announcementRolesChannelTopic(
  orgId: string,
  userId: string,
  instanceKey: string
): string {
  return `announcement-roles:${orgId}:${userId}:${instanceKey}`;
}

export function unreadAnnouncementsChannelTopic(orgId: string, instanceKey: string): string {
  return `unread-announcements:${orgId}:${instanceKey}`;
}
