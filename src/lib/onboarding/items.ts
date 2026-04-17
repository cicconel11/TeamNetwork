import type { OrgRole } from "@/lib/auth/role-utils";
import type { OnboardingItemId } from "@/lib/schemas/onboarding";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingItem {
  readonly id: OnboardingItemId;
  readonly title: string;
  readonly description: string;
  /** Generates the deep-link URL. Receives the org slug. */
  readonly href: (orgSlug: string, memberId?: string) => string;
  /** Empty array = visible to all roles. */
  readonly roles: readonly OrgRole[];
  readonly requiresAlumniAccess?: boolean;
  readonly requiresParentsAccess?: boolean;
  /**
   * Name of the auto-detection key returned by the /api/onboarding/status
   * endpoint. When present, the item auto-checks on detection.
   * When absent, only manual "Mark done" completes the item.
   */
  readonly detectKey?: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const ONBOARDING_ITEMS: readonly OnboardingItem[] = [
  // ── Universal ──────────────────────────────────────────────────────────────
  {
    id: "complete_profile",
    title: "Complete your profile",
    description: "Add a photo and bio so teammates know who you are.",
    href: (orgSlug, memberId) =>
      memberId ? `/${orgSlug}/members/${memberId}/edit` : `/${orgSlug}/members`,
    roles: [],
    detectKey: "has_profile_photo",
  },
  {
    id: "post_feed",
    title: "Post in the feed",
    description: "Share an update, photo, or poll with your org.",
    href: (orgSlug) => `/${orgSlug}/feed`,
    roles: [],
    detectKey: "has_feed_post",
  },
  {
    id: "rsvp_event",
    title: "RSVP to an event",
    description: "Find an upcoming event on the calendar and RSVP.",
    href: (orgSlug) => `/${orgSlug}/calendar`,
    roles: [],
    detectKey: "has_rsvp",
  },
  {
    id: "send_message",
    title: "Send a message",
    description: "Start or join a conversation in Messages.",
    href: (orgSlug) => `/${orgSlug}/messages`,
    roles: [],
    detectKey: "has_sent_message",
  },
  {
    id: "read_announcement",
    title: "Read an announcement",
    description: "Check the latest announcements from your org.",
    href: (orgSlug) => `/${orgSlug}/announcements`,
    roles: [],
    // Detected via client-side visit flag, persisted as visitedItem
    detectKey: "visited_announcements",
  },
  {
    id: "configure_notifications",
    title: "Configure notifications",
    description: "Choose which emails you want to receive.",
    href: () => "/settings/notifications",
    roles: [],
    detectKey: "has_notification_prefs",
  },
  // ── Alumni-only ─────────────────────────────────────────────────────────────
  {
    id: "update_linkedin",
    title: "Add your LinkedIn",
    description: "Connect your LinkedIn profile for the alumni directory.",
    href: () => "/settings/linkedin",
    roles: ["alumni"],
    requiresAlumniAccess: true,
    detectKey: "has_linkedin",
  },
  {
    id: "browse_alumni_directory",
    title: "Browse the alumni directory",
    description: "Filter by industry, class year, or location.",
    href: (orgSlug) => `/${orgSlug}/alumni`,
    roles: ["alumni"],
    requiresAlumniAccess: true,
    detectKey: "visited_alumni_directory",
  },
  // ── Active-member-only ──────────────────────────────────────────────────────
  {
    id: "log_workout",
    title: "Log a workout",
    description: "Record or view today's workout results.",
    href: (orgSlug) => `/${orgSlug}/workouts`,
    roles: ["active_member", "admin"],
    detectKey: "has_logged_workout",
  },
] as const;
