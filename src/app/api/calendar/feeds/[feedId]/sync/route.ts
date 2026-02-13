import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CALENDAR_FEED_SYNC_SELECT, syncFeedByProvider } from "@/lib/calendar/feedSync";

export const dynamic = "force-dynamic";

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

function maskFeedUrl(feedUrl: string) {
  if (feedUrl.startsWith("google://")) {
    return `google://${feedUrl.slice("google://".length, "google://".length + 10)}...`;
  }
  try {
    const parsed = new URL(feedUrl);
    const tail = feedUrl.slice(-6);
    return `${parsed.host}/...${tail}`;
  } catch {
    return "hidden";
  }
}

export async function POST(
  _request: Request,
  { params }: { params: { feedId: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to sync feeds." },
        { status: 401 }
      );
    }

    const { data: feed, error } = await (supabase as any)
      .from("calendar_feeds")
      .select(CALENDAR_FEED_SYNC_SELECT)
      .eq("id", params.feedId)
      .eq("user_id", user.id)
      .eq("scope", "personal")
      .single() as {
      data: CalendarFeedSyncRow | null;
      error: { message: string } | null;
    };

    if (error || !feed) {
      return NextResponse.json(
        { error: "Not found", message: "Feed not found." },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();
    await syncFeedByProvider(serviceClient, feed as any);

    const { data: updatedFeed } = await serviceClient
      .from("calendar_feeds")
      .select("id, feed_url, status, last_synced_at, last_error, provider")
      .eq("id", feed.id)
      .single();

    const responseFeed = updatedFeed ?? feed;

    return NextResponse.json({
      id: responseFeed.id,
      maskedUrl: maskFeedUrl(responseFeed.feed_url),
      status: responseFeed.status,
      last_synced_at: responseFeed.last_synced_at,
      last_error: responseFeed.last_error,
      provider: responseFeed.provider,
    });
  } catch (error) {
    console.error("[calendar-feeds-sync] Error syncing feed:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to sync feed." },
      { status: 500 }
    );
  }
}
