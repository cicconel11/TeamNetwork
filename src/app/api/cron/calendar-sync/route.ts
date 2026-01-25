import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncCalendarFeed } from "@/lib/calendar/icsSync";

export const dynamic = "force-dynamic";

const SYNC_INTERVAL_MINUTES = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return { ok: false, reason: "Missing CRON_SECRET" };
  }

  const authHeader = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");
  const urlSecret = new URL(request.url).searchParams.get("secret");

  if (authHeader === `Bearer ${secret}` || headerSecret === secret || urlSecret === secret) {
    return { ok: true };
  }

  return { ok: false, reason: "Unauthorized" };
}

export async function GET(request: Request) {
  const authResult = isAuthorized(request);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: "Unauthorized", message: authResult.reason },
      { status: authResult.reason === "Missing CRON_SECRET" ? 500 : 401 }
    );
  }

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
    const result = await syncCalendarFeed(serviceClient, feed);
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
