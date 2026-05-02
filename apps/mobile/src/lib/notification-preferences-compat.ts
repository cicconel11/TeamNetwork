/**
 * Production may run an older Supabase schema before migration
 * `20261101000000_notification_jobs_and_push_prefs.sql` (per-category *_push_enabled).
 * PostgREST surfaces missing columns as an error on SELECT/INSERT/UPDATE.
 */

export const LEGACY_NOTIFICATION_PREF_SELECT_COLUMNS =
  "id,email_address,email_enabled,push_enabled";

/** True when PostgREST/Postgres reports an undefined_column for push-pref fields. */
export function isMissingPerCategoryPushPreferenceColumnsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg =
    "message" in error && typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  if (!msg.includes("does not exist")) return false;
  return (
    msg.includes("announcement_push_enabled") ||
    msg.includes("chat_push_enabled") ||
    msg.includes("event_reminder_push_enabled") ||
    msg.includes("event_push_enabled") ||
    msg.includes("workout_push_enabled") ||
    msg.includes("competition_push_enabled") ||
    msg.includes("discussion_push_enabled") ||
    msg.includes("mentorship_push_enabled") ||
    msg.includes("donation_push_enabled")
  );
}
