import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CALENDAR_FEED_SYNC_SELECT, syncFeedByProvider } from "@/lib/calendar/feedSync";
import type { CalendarFeedRow } from "@/lib/calendar/syncHelpers";

export const dynamic = "force-dynamic";

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

async function handleSync(params: { feedId: string }) {
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
      .select(CALENDAR_FEED_SYNC_SELECT)
      .eq("id", params.feedId)
      .eq("scope", "org")
      .single();
    const typedFeed = feed as CalendarFeedRow | null;

    if (error || !typedFeed) {
      return NextResponse.json(
        { error: "Not found", message: "Feed not found." },
        { status: 404 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", typedFeed.organization_id)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can sync org feeds." },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    await syncFeedByProvider(serviceClient, typedFeed);

    const { data: updatedFeed } = await serviceClient
      .from("calendar_feeds")
      .select("id, feed_url, status, last_synced_at, last_error, provider")
      .eq("id", typedFeed.id)
      .single();

    const responseFeed = updatedFeed ?? typedFeed;

    return NextResponse.json({
      id: responseFeed.id,
      maskedUrl: maskFeedUrl(responseFeed.feed_url),
      status: responseFeed.status,
      last_synced_at: responseFeed.last_synced_at,
      last_error: responseFeed.last_error,
      provider: responseFeed.provider,
    });
  } catch (error) {
    console.error("[calendar-org-feeds-sync] Error syncing feed:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to sync feed." },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: { feedId: string } }
) {
  return handleSync(params);
}

export async function GET(
  _request: Request,
  { params }: { params: { feedId: string } }
) {
  return handleSync(params);
}

export async function PUT(
  _request: Request,
  { params }: { params: { feedId: string } }
) {
  return handleSync(params);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
