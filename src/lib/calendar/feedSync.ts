import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { syncCalendarFeed } from "./icsSync";
import { syncGoogleCalendarFeed } from "./googleSync";
import type { CalendarFeedRow, SyncResult } from "./syncHelpers";

export const CALENDAR_FEED_SYNC_SELECT = "id, user_id, feed_url, status, last_synced_at, last_error, provider, created_at, updated_at, organization_id, scope, connected_user_id, google_calendar_id";

export function isGoogleFeedProvider(provider: string | null | undefined) {
  return provider === "google";
}

export async function syncFeedByProvider(
  supabase: SupabaseClient<Database>,
  feed: CalendarFeedRow
): Promise<SyncResult> {
  if (isGoogleFeedProvider(feed.provider)) {
    return syncGoogleCalendarFeed(supabase, feed);
  }

  return syncCalendarFeed(supabase, feed);
}
