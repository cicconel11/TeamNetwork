import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CALENDAR_FEED_SYNC_SELECT, syncFeedByProvider } from "@/lib/calendar/feedSync";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";

const SYNC_INTERVAL_MINUTES = 60;

type CalendarFeedSyncRow = {
  id: string;
  user_id: string;
  feed_url: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  provider: string;
  created_at: string | null;
  updated_at: string | null;
  organization_id: string | null;
  scope: string;
  connected_user_id: string | null;
  google_calendar_id: string | null;
};

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const serviceClient = createServiceClient();
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60 * 1000).toISOString();

  const { data: feeds, error } = await (serviceClient as any)
    .from("calendar_feeds")
    .select(CALENDAR_FEED_SYNC_SELECT)
    .eq("status", "active")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`) as {
    data: CalendarFeedSyncRow[] | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error("[calendar-cron] Failed to load feeds:", error);
    return NextResponse.json(
      { error: "Database error", message: "Failed to load feeds." },
      { status: 500 }
    );
  }

  let successCount = 0;
  let failureCount = 0;
  const results: { id: string; status: string; lastError: string | null }[] = [];

  for (const feed of feeds || []) {
    const result = await syncFeedByProvider(serviceClient, feed as any);

    if (result.status === "active") {
      successCount += 1;
    } else {
      failureCount += 1;
    }

    results.push({
      id: feed.id,
      status: result.status,
      lastError: result.lastError,
    });
  }

  return NextResponse.json({
    processed: (feeds || []).length,
    success: successCount,
    failed: failureCount,
    results,
  });
}
