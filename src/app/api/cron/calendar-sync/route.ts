import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncCalendarFeed } from "@/lib/calendar/icsSync";
import { syncGoogleCalendarFeed } from "@/lib/calendar/googleSync";
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
    .select("id, user_id, feed_url, status, last_synced_at, last_error, provider, created_at, updated_at, organization_id, scope")
    .eq("status", "active")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);

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
    let result;

    if (feed.provider === "google") {
      result = await syncGoogleCalendarFeed(serviceClient, feed);
    } else {
      result = await syncCalendarFeed(serviceClient, feed);
    }

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
