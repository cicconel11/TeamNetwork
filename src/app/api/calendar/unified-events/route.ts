import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { fetchUnifiedEvents, parseSourcesParam } from "@/lib/calendar/unified-events";

const MAX_EVENTS = 2000;
const MAX_DATE_RANGE_DAYS = 400;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ipRateLimit = checkRateLimit(request, {
    limitPerIp: 30,
    limitPerUser: 0,
    windowMs: 60_000,
    feature: "unified events",
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
        { status: 401 }
      );
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0,
      limitPerUser: 20,
      windowMs: 60_000,
      feature: "unified events",
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const sourcesParam = url.searchParams.get("sources");

    const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
    const limitParam = parseInt(url.searchParams.get("limit") || String(MAX_EVENTS), 10);
    const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
    const limit = Number.isNaN(limitParam) || limitParam < 1 ? MAX_EVENTS : Math.min(limitParam, MAX_EVENTS);
    const offset = (page - 1) * limit;

    if (!orgId || !startParam || !endParam) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId, start, and end are required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked") {
      return NextResponse.json(
        { error: "Forbidden", message: "You are not a member of this organization." },
        { status: 403 }
      );
    }

    const start = new Date(startParam);
    const end = new Date(endParam);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json(
        { error: "Invalid parameters", message: "start and end must be valid ISO dates." },
        { status: 400 }
      );
    }
    if (start > end) {
      return NextResponse.json(
        { error: "Invalid parameters", message: "start must be before end." },
        { status: 400 }
      );
    }

    const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (rangeDays > MAX_DATE_RANGE_DAYS) {
      return NextResponse.json(
        { error: "Invalid parameters", message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.` },
        { status: 400 }
      );
    }

    const sources = parseSourcesParam(sourcesParam);
    const allEvents = await fetchUnifiedEvents(supabase, orgId, user.id, {
      start,
      end,
      sources,
    });

    const total = allEvents.length;
    const paginatedEvents = allEvents.slice(offset, offset + limit);
    const truncated = total > MAX_EVENTS;
    const hasMore = offset + paginatedEvents.length < total;

    return NextResponse.json(
      {
        events: paginatedEvents,
        meta: {
          count: paginatedEvents.length,
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
    console.error("[unified-events] Error fetching events:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to fetch events." },
      { status: 500 }
    );
  }
}
