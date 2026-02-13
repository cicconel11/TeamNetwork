import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncCalendarFeed } from "@/lib/calendar/icsSync";
import { syncGoogleCalendarFeed } from "@/lib/calendar/googleSync";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { calendarFeedCreateSchema, googleCalendarFeedCreateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

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

function parseBodyWithSchema<T>(
  rawBody: unknown,
  schema: z.ZodType<T>
): T {
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const path = issue.path.map((part) => String(part)).join(".");
      return `${path || "body"}: ${issue.message}`;
    });
    throw new ValidationError("Invalid request body", details);
  }

  return parsed.data;
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "org calendar feeds",
      limitPerIp: 60,
      limitPerUser: 45,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (authError || !user) {
      return respond(
        { error: "Unauthorized", message: "You must be logged in to view feeds." },
        401
      );
    }

    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");

    if (!organizationId) {
      return respond(
        { error: "Missing parameter", message: "organizationId is required." },
        400
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return respond(
        { error: "Forbidden", message: "Only admins can manage org calendar feeds." },
        403
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
      return respond(
        { error: "Database error", message: "Failed to fetch feeds." },
        500
      );
    }

    return respond({
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

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "org calendar feed creation",
      limitPerIp: 30,
      limitPerUser: 20,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (authError || !user) {
      return respond(
        { error: "Unauthorized", message: "You must be logged in to add a feed." },
        401
      );
    }

    // Peek at the body to determine which schema to use
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new ValidationError("Invalid JSON payload");
    }
    const isGoogle = (rawBody as { provider?: string } | null)?.provider === "google";

    if (isGoogle) {
      return handleGoogleFeedCreate(supabase, user, rawBody, respond);
    }

    return handleIcsFeedCreate(supabase, user, rawBody, respond);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    console.error("[calendar-org-feeds] Error adding feed:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to add feed." },
      { status: 500 }
    );
  }
}

// ---------- ICS feed creation ----------

async function handleIcsFeedCreate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string },
  rawBody: unknown,
  respond: (payload: unknown, status?: number) => NextResponse
) {
  const body = parseBodyWithSchema(rawBody, calendarFeedCreateSchema);

  const { data: membership } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", body.organizationId)
    .maybeSingle();

  if (!membership || membership.status === "revoked" || membership.role !== "admin") {
    return respond(
      { error: "Forbidden", message: "Only admins can manage org calendar feeds." },
      403
    );
  }

  const { isReadOnly } = await checkOrgReadOnly(body.organizationId);
  if (isReadOnly) {
    return respond(readOnlyResponse(), 403);
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeFeedUrl(body.feedUrl);
  } catch (error) {
    return respond(
      { error: "Invalid feedUrl", message: error instanceof Error ? error.message : "Invalid feed URL." },
      400
    );
  }

  if (!isLikelyIcsUrl(normalizedUrl)) {
    return respond(
      { error: "Invalid feedUrl", message: "Feed URL does not look like an ICS calendar link." },
      400
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
    .select("id, user_id, feed_url, status, last_synced_at, last_error, provider, created_at, updated_at, organization_id, scope, connected_user_id, google_calendar_id")
    .single();

  if (error || !feed) {
    console.error("[calendar-org-feeds] Failed to insert feed:", error);
    return respond(
      { error: "Database error", message: "Failed to save feed." },
      500
    );
  }

  const serviceClient = createServiceClient();
  await syncCalendarFeed(serviceClient, feed);

  const { data: updatedFeed } = await serviceClient
    .from("calendar_feeds")
    .select("id, feed_url, status, last_synced_at, last_error, provider")
    .eq("id", feed.id)
    .single();

  return respond(
    formatFeedResponse(updatedFeed ?? feed),
    201
  );
}

// ---------- Google Calendar feed creation ----------

async function handleGoogleFeedCreate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string },
  rawBody: unknown,
  respond: (payload: unknown, status?: number) => NextResponse
) {
  const body = parseBodyWithSchema(rawBody, googleCalendarFeedCreateSchema);

  const { data: membership } = await supabase
    .from("user_organization_roles")
    .select("role,status")
    .eq("user_id", user.id)
    .eq("organization_id", body.organizationId)
    .maybeSingle();

  if (!membership || membership.status === "revoked" || membership.role !== "admin") {
    return respond(
      { error: "Forbidden", message: "Only admins can manage org calendar feeds." },
      403
    );
  }

  const { isReadOnly } = await checkOrgReadOnly(body.organizationId);
  if (isReadOnly) {
    return respond(readOnlyResponse(), 403);
  }

  // Verify admin has a connected Google account
  const { data: connection } = await supabase
    .from("user_calendar_connections")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!connection || connection.status !== "connected") {
    return respond(
      { error: "No Google connection", message: "You must connect your Google account before adding a Google Calendar feed." },
      400
    );
  }

  const feedUrl = `google://${body.googleCalendarId}`;

  const { data: feed, error } = await supabase
    .from("calendar_feeds")
    .insert({
      user_id: user.id,
      provider: "google",
      feed_url: feedUrl,
      organization_id: body.organizationId,
      scope: "org",
      connected_user_id: user.id,
      google_calendar_id: body.googleCalendarId,
    })
    .select("id, user_id, feed_url, status, last_synced_at, last_error, provider, created_at, updated_at, organization_id, scope")
    .single();

  if (error || !feed) {
    console.error("[calendar-org-feeds] Failed to insert Google feed:", error);
    return respond(
      { error: "Database error", message: "Failed to save feed." },
      500
    );
  }

  // Trigger initial sync
  const serviceClient = createServiceClient();
  await syncGoogleCalendarFeed(serviceClient, {
    ...(feed as Record<string, unknown>),
    connected_user_id: user.id,
    google_calendar_id: body.googleCalendarId,
  } as any);

  const { data: updatedFeed } = await serviceClient
    .from("calendar_feeds")
    .select("id, feed_url, status, last_synced_at, last_error, provider")
    .eq("id", feed.id)
    .single();

  return respond(
    formatFeedResponse(updatedFeed ?? feed),
    201
  );
}
