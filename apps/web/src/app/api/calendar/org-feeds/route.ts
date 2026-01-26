import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncCalendarFeed } from "@/lib/calendar/icsSync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeFeedUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  const normalized = trimmed.startsWith("webcal://") ? `https://${trimmed.slice("webcal://".length)}` : trimmed;
  const parsed = new URL(normalized);

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("Feed URL must start with http(s) or webcal.");
  }

  return parsed.toString();
}

function isLikelyIcsUrl(feedUrl: string) {
  const lower = feedUrl.toLowerCase();
  return lower.includes(".ics") || lower.includes("ical") || lower.includes("calendar");
}

function maskFeedUrl(feedUrl: string) {
  try {
    const parsed = new URL(feedUrl);
    const tail = feedUrl.slice(-6);
    return `${parsed.host}/...${tail}`;
  } catch {
    return "hidden";
  }
}

function formatFeedResponse(feed: {
  id: string;
  feed_url: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  provider: string;
}) {
  return {
    id: feed.id,
    maskedUrl: maskFeedUrl(feed.feed_url),
    status: feed.status,
    last_synced_at: feed.last_synced_at,
    last_error: feed.last_error,
    provider: feed.provider,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view feeds." },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");

    if (!organizationId) {
      return NextResponse.json(
        { error: "Missing parameter", message: "organizationId is required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can manage org calendar feeds." },
        { status: 403 }
      );
    }

    const { data: feeds, error } = await supabase
      .from("calendar_feeds")
      .select("id, feed_url, status, last_synced_at, last_error, provider")
      .eq("organization_id", organizationId)
      .eq("scope", "org")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[calendar-org-feeds] Failed to fetch feeds:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch feeds." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      feeds: (feeds || []).map(formatFeedResponse),
    });
  } catch (error) {
    console.error("[calendar-org-feeds] Error fetching feeds:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to fetch feeds." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to add a feed." },
        { status: 401 }
      );
    }

    let body: { feedUrl?: string; provider?: string; organizationId?: string };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    if (!body.feedUrl) {
      return NextResponse.json(
        { error: "Missing feedUrl", message: "feedUrl is required." },
        { status: 400 }
      );
    }

    if (!body.organizationId) {
      return NextResponse.json(
        { error: "Missing organizationId", message: "organizationId is required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", body.organizationId)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can manage org calendar feeds." },
        { status: 403 }
      );
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeFeedUrl(body.feedUrl);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid feedUrl", message: error instanceof Error ? error.message : "Invalid feed URL." },
        { status: 400 }
      );
    }

    if (!isLikelyIcsUrl(normalizedUrl)) {
      return NextResponse.json(
        { error: "Invalid feedUrl", message: "Feed URL does not look like an ICS calendar link." },
        { status: 400 }
      );
    }

    const provider = body.provider === "ics" || !body.provider ? "ics" : body.provider;

    const { data: feed, error } = await supabase
      .from("calendar_feeds")
      .insert({
        user_id: user.id,
        provider,
        feed_url: normalizedUrl,
        organization_id: body.organizationId,
        scope: "org",
      })
      .select("id, user_id, feed_url, status, last_synced_at, last_error, provider, created_at, updated_at, organization_id, scope")
      .single();

    if (error || !feed) {
      console.error("[calendar-org-feeds] Failed to insert feed:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to save feed." },
        { status: 500 }
      );
    }

    const serviceClient = createServiceClient();
    await syncCalendarFeed(serviceClient, feed);

    const { data: updatedFeed } = await serviceClient
      .from("calendar_feeds")
      .select("id, feed_url, status, last_synced_at, last_error, provider")
      .eq("id", feed.id)
      .single();

    return NextResponse.json(
      formatFeedResponse(updatedFeed ?? feed),
      { status: 201 }
    );
  } catch (error) {
    console.error("[calendar-org-feeds] Error adding feed:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to add feed." },
      { status: 500 }
    );
  }
}
