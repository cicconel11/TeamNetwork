import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { debugLog } from "@/lib/debug";

const MAX_EVENTS = 2000;
const MAX_DATE_RANGE_DAYS = 400;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Apply IP-based rate limiting FIRST (before auth) to protect against unauthenticated abuse
  const ipRateLimit = checkRateLimit(request, {
    limitPerIp: 30,
    limitPerUser: 0, // IP-only, no user limit yet
    windowMs: 60_000,
    feature: "schedule events",
  });

  if (!ipRateLimit.ok) {
    return buildRateLimitResponse(ipRateLimit);
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view events." },
        { status: 401, headers: ipRateLimit.headers }
      );
    }

    // Apply stricter user-based rate limiting for authenticated users
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0, // Already checked above
      limitPerUser: 20,
      windowMs: 60_000,
      feature: "schedule events",
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    if (!orgId || !fromParam || !toParam) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId, from, and to are required." },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    // Note: We intentionally allow all org members (not just admins) to view schedule events.
    // This is read-only display data for the calendar UI - no admin role check needed.
    if (!membership || membership.status === "revoked") {
      return NextResponse.json(
        { error: "Forbidden", message: "You are not a member of this organization." },
        { status: 403, headers: rateLimit.headers }
      );
    }

    const from = new Date(fromParam);
    const to = new Date(toParam);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json(
        { error: "Invalid parameters", message: "from and to must be valid ISO dates." },
        { status: 400, headers: rateLimit.headers }
      );
    }

    if (from > to) {
      return NextResponse.json(
        { error: "Invalid parameters", message: "start must be before end." },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const rangeDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    if (rangeDays > MAX_DATE_RANGE_DAYS) {
      return NextResponse.json(
        { error: "Invalid parameters", message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.` },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const includeCancelled = url.searchParams.get("include_cancelled") === "true";
    const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
    const limitParam = parseInt(url.searchParams.get("limit") || String(MAX_EVENTS), 10);
    const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limit = Number.isNaN(limitParam) || limitParam < 1 ? MAX_EVENTS : Math.min(limitParam, MAX_EVENTS);
    const offset = (page - 1) * limit;

    let query = supabase
      .from("schedule_events")
      .select("id, source_id, title, start_at, end_at, location, status", { count: "exact" })
      .eq("org_id", orgId)
      .gte("start_at", from.toISOString())
      .lte("start_at", to.toISOString());

    if (!includeCancelled) {
      query = query.neq("status", "cancelled");
    }

    const { data: events, error, count } = await query
      .range(offset, offset + limit - 1)
      .order("start_at", { ascending: true });

    if (error) {
      console.error("[schedule-events] Failed to fetch events:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch events." },
        { status: 500, headers: rateLimit.headers }
      );
    }

    const returnedEvents = events || [];
    const total = count ?? returnedEvents.length;
    const truncated = total > limit;
    const hasMore = offset + returnedEvents.length < total;

    debugLog("schedule-events", "query result", {
      total,
      page,
      limit,
      truncated,
      hasMore,
      includeCancelled,
      dateRange: { from: fromParam, to: toParam },
    });

    return NextResponse.json(
      {
        events: returnedEvents,
        meta: {
          count: returnedEvents.length,
          total,
          page,
          limit,
          hasMore,
          truncated,
        },
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    console.error("[schedule-events] Error:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to load events." },
      { status: 500, headers: ipRateLimit.headers }
    );
  }
}
