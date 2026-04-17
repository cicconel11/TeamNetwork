import type { OnboardingItemId } from "@/lib/schemas/onboarding";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectionContext {
  userId: string;
  orgId: string;
  memberId?: string | null;
}

// ─── Detection helpers ────────────────────────────────────────────────────────

/**
 * Runs parallel Supabase queries to determine which onboarding items
 * the user has already completed. Returns an array of auto-completed item IDs.
 *
 * Must be called from a server context (Route Handler or Server Action)
 * as it uses the server Supabase client.
 *
 * Column references verified against src/types/database.ts:
 * - feed_posts.author_id
 * - chat_messages.author_id
 * - workout_logs.user_id (NOT workouts — workouts is a prescription catalog)
 * - event_rsvps.user_id
 * - notification_preferences.user_id
 * - members.photo_url / linkedin_url / bio
 */
export async function detectCompletedItems(
  ctx: DetectionContext
): Promise<OnboardingItemId[]> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { userId, orgId, memberId } = ctx;

  // Run all detection queries in parallel — same idiom as pendingApprovalsCount
  const [
    profileResult,
    feedPostResult,
    rsvpResult,
    messageResult,
    notifPrefsResult,
    linkedInResult,
    workoutResult,
  ] = await Promise.all([
    // has_profile_photo + bio: member row has BOTH non-null photo_url and
    // a non-empty bio. Returned data.bio is checked in JS since we can't
    // trivially express "length > 0" with the Supabase query builder.
    memberId
      ? supabase
          .from("members")
          .select("photo_url, bio")
          .eq("id", memberId)
          .not("photo_url", "is", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    // has_feed_post: user has posted at least one feed post in this org
    supabase
      .from("feed_posts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("author_id", userId)
      .is("deleted_at", null),

    // has_rsvp: user has RSVPed to at least one event in this org
    supabase
      .from("event_rsvps")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("user_id", userId),

    // has_sent_message: user has sent at least one chat message in this org
    supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("author_id", userId)
      .is("deleted_at", null),

    // has_notification_prefs: user has a notification_preferences row for this org
    supabase
      .from("notification_preferences")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("user_id", userId),

    // has_linkedin: member has a linkedin_url set
    memberId
      ? supabase
          .from("members")
          .select("linkedin_url")
          .eq("id", memberId)
          .not("linkedin_url", "is", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    // has_logged_workout: user has logged at least one workout log in this org
    supabase
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("user_id", userId),
  ]);

  const autoCompleted: OnboardingItemId[] = [];

  // complete_profile: photo present AND bio has content
  if (!profileResult.error && profileResult.data) {
    const row = profileResult.data as { photo_url: string | null; bio: string | null };
    if (row.photo_url && row.bio && row.bio.trim().length > 0) {
      autoCompleted.push("complete_profile");
    }
  }

  // Count-based checks
  if (!feedPostResult.error && (feedPostResult.count ?? 0) > 0) {
    autoCompleted.push("post_feed");
  }

  if (!rsvpResult.error && (rsvpResult.count ?? 0) > 0) {
    autoCompleted.push("rsvp_event");
  }

  if (!messageResult.error && (messageResult.count ?? 0) > 0) {
    autoCompleted.push("send_message");
  }

  if (!notifPrefsResult.error && (notifPrefsResult.count ?? 0) > 0) {
    autoCompleted.push("configure_notifications");
  }

  if (!linkedInResult.error && linkedInResult.data) {
    autoCompleted.push("update_linkedin");
  }

  if (!workoutResult.error && (workoutResult.count ?? 0) > 0) {
    autoCompleted.push("log_workout");
  }

  return autoCompleted;
}
