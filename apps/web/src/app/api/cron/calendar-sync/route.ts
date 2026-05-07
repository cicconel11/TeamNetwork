import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CALENDAR_FEED_SYNC_SELECT, syncFeedByProvider } from "@/lib/calendar/feedSync";
import type { CalendarFeedRow } from "@/lib/calendar/syncHelpers";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";

const SYNC_INTERVAL_MINUTES = 60;

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const serviceClient = createServiceClient();
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60 * 1000).toISOString();

  const { data: feeds, error } = await serviceClient
    .from("calendar_feeds")
    .select(CALENDAR_FEED_SYNC_SELECT)
    .eq("status", "active")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);
  const typedFeeds = (feeds ?? []) as CalendarFeedRow[];

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

  for (const feed of typedFeeds) {
    const result = await syncFeedByProvider(serviceClient, feed);

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
    processed: typedFeeds.length,
    success: successCount,
    failed: failureCount,
    results,
  });
}
