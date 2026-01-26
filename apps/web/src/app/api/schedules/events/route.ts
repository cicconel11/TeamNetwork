import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

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

    const { data: events, error } = await supabase
      .from("schedule_events")
      .select("id, source_id, title, start_at, end_at, location, status")
      .eq("org_id", orgId)
      .gte("start_at", from.toISOString())
      .lte("start_at", to.toISOString())
      .order("start_at", { ascending: true });

    if (error) {
      console.error("[schedule-events] Failed to fetch events:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch events." },
        { status: 500, headers: rateLimit.headers }
      );
    }

    return NextResponse.json({ events: events || [] }, { headers: rateLimit.headers });
  } catch (error) {
    console.error("[schedule-events] Error:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to load events." },
      { status: 500, headers: ipRateLimit.headers }
    );
  }
}
