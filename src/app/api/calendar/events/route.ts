import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view events." },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    if (!organizationId || !startParam || !endParam) {
      return NextResponse.json(
        { error: "Missing parameters", message: "organizationId, start, and end are required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
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

    // Query current user's calendar events
    // Note: RLS policy only allows users to see their own events (auth.uid() = user_id),
    // so we can only fetch the current user's events regardless of mode
    
    // Expand the date range to catch all-day events and multi-day events
    // that might start before but overlap with the requested range
    const expandedStart = new Date(start);
    expandedStart.setDate(expandedStart.getDate() - 7); // Look 7 days before
    
    const { data: events, error } = await supabase
      .from("calendar_events")
      .select("id, title, start_at, end_at, all_day, location, feed_id, user_id")
      .eq("user_id", user.id)
      .gte("start_at", expandedStart.toISOString())
      .lte("start_at", end.toISOString())
      .order("start_at", { ascending: true });

    if (error) {
      console.error("[calendar-events] Failed to fetch events:", error);
      console.error("[calendar-events] Query params - user_id:", user.id, "start:", expandedStart.toISOString(), "end:", end.toISOString());
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch events." },
        { status: 500 }
      );
    }

    console.log("[calendar-events] Found", events?.length || 0, "events for user", user.id);
    return NextResponse.json({ events: events || [] });
  } catch (error) {
    console.error("[calendar-events] Error fetching events:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to fetch events." },
      { status: 500 }
    );
  }
}
