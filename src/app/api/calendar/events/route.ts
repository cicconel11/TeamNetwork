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

    // Helper to build query with organization_id filter (for migrated DBs)
    const buildOrgQuery = () => {
      let q = supabase
        .from("calendar_events")
        .select("id, title, start_at, end_at, all_day, location, feed_id, user_id, users(name, email)")
        .eq("organization_id", organizationId)
        .gte("start_at", start.toISOString())
        .lte("start_at", end.toISOString())
        .order("start_at", { ascending: true });

      if (modeParam === "personal") {
        q = q.eq("user_id", user.id);
      }

      return q;
    };

    // Helper to build query by user_id only (for pre-migration DBs without organization_id)
    const buildUserQuery = () => {
      return supabase
        .from("calendar_events")
        .select("id, title, start_at, end_at, all_day, location, feed_id, user_id, users(name, email)")
        .eq("user_id", user.id)
        .gte("start_at", start.toISOString())
        .lte("start_at", end.toISOString())
        .order("start_at", { ascending: true });
    };

    // Try with organization_id and scope filter first (fully migrated DBs)
    const { data: events, error } = await buildOrgQuery().eq("scope", "personal");

    if (error) {
      const errorStr = JSON.stringify(error);
      const isColumnError = errorStr.includes("scope") ||
        errorStr.includes("organization_id") ||
        error.message?.includes("scope") ||
        error.message?.includes("organization_id") ||
        error.code === "42703"; // PostgreSQL "column does not exist"

      if (isColumnError) {
        console.warn("[calendar-events] Column not found, falling back to user_id query");
        // Fall back to querying by user_id only (for pre-migration databases)
        const { data: fallbackEvents, error: fallbackError } = await buildUserQuery();

        if (fallbackError) {
          console.error("[calendar-events] Fallback query failed:", fallbackError);
          return NextResponse.json(
            { error: "Database error", message: "Failed to fetch events." },
            { status: 500 }
          );
        }

        return NextResponse.json({ events: fallbackEvents || [] });
      }

      console.error("[calendar-events] Failed to fetch events:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch events." },
        { status: 500 }
      );
    }

    // If no events found with org filter, also try user_id fallback
    // This handles events synced before the migration added organization_id
    if (!events || events.length === 0) {
      const { data: userEvents, error: userError } = await buildUserQuery();

      if (!userError && userEvents && userEvents.length > 0) {
        return NextResponse.json({ events: userEvents });
      }
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
