import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncCalendarFeed } from "@/lib/calendar/icsSync";

export const dynamic = "force-dynamic";

function maskFeedUrl(feedUrl: string) {
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

    const { data: feed, error } = await supabase
      .from("calendar_feeds")
      .select("id, user_id, feed_url, status, last_synced_at, last_error, provider, created_at, updated_at")
      .eq("id", params.feedId)
      .eq("user_id", user.id)
      .single();

    if (error || !feed) {
      return NextResponse.json(
        { error: "Not found", message: "Feed not found." },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();
    await syncCalendarFeed(serviceClient, feed);

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
