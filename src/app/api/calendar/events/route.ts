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
    // When mode=personal, only fetch the current user's events
    const modeParam = url.searchParams.get("mode");

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

    // Build the query - filter by user_id in personal mode to avoid counting
    // other users' events as conflicts
    let query = supabase
      .from("calendar_events")
      .select("id, title, start_at, end_at, all_day, location, feed_id, user_id, users(name, email)")
      .eq("organization_id", organizationId)
      .gte("start_at", start.toISOString())
      .lte("start_at", end.toISOString())
      .order("start_at", { ascending: true });

    // Filter by scope if the column exists (graceful fallback for pre-migration DBs)
    // In personal mode, only show current user's events
    if (modeParam === "personal") {
      query = query.eq("user_id", user.id);
    }

    // Try to filter by scope, but handle gracefully if column doesn't exist
    try {
      query = query.eq("scope", "personal");
    } catch {
      // scope column may not exist yet - continue without filter
    }

    const { data: events, error } = await query;

    if (error) {
      // Check if error is due to missing scope column
      if (error.message?.includes("scope")) {
        console.warn("[calendar-events] scope column not found, retrying without scope filter");
        // Retry without scope filter
        let retryQuery = supabase
          .from("calendar_events")
          .select("id, title, start_at, end_at, all_day, location, feed_id, user_id, users(name, email)")
          .eq("organization_id", organizationId)
          .gte("start_at", start.toISOString())
          .lte("start_at", end.toISOString())
          .order("start_at", { ascending: true });

        if (modeParam === "personal") {
          retryQuery = retryQuery.eq("user_id", user.id);
        }

        const { data: retryEvents, error: retryError } = await retryQuery;

        if (retryError) {
          console.error("[calendar-events] Retry failed:", retryError);
          return NextResponse.json(
            { error: "Database error", message: "Failed to fetch events." },
            { status: 500 }
          );
        }

        return NextResponse.json({ events: retryEvents || [] });
      }

      console.error("[calendar-events] Failed to fetch events:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch events." },
        { status: 500 }
      );
    }

    return NextResponse.json({ events: events || [] });
  } catch (error) {
    console.error("[calendar-events] Error fetching events:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to fetch events." },
      { status: 500 }
    );
  }
}
