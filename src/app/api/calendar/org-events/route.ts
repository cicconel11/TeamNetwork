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

    let calendarEvents: {
      id: string;
      title: string | null;
      start_at: string;
      end_at: string | null;
      all_day: boolean | null;
      location: string | null;
      feed_id: string;
    }[] = [];

    // Try with scope filter first, fall back if column doesn't exist
    const { data: events, error } = await supabase
      .from("calendar_events")
      .select("id, title, start_at, end_at, all_day, location, feed_id")
      .eq("organization_id", organizationId)
      .eq("scope", "org")
      .gte("start_at", start.toISOString())
      .lte("start_at", end.toISOString())
      .order("start_at", { ascending: true });

    if (error) {
      // Check if error is due to missing scope column
      const errorStr = JSON.stringify(error);
      const isScopeError = errorStr.includes("scope") ||
        error.message?.includes("scope") ||
        error.code === "42703"; // PostgreSQL "column does not exist"

      if (isScopeError) {
        console.warn("[calendar-org-events] scope column not found, returning schedule events only");
      } else {
        console.error("[calendar-org-events] Failed to fetch events:", error);
        return NextResponse.json(
          { error: "Database error", message: "Failed to fetch events." },
          { status: 500 }
        );
      }
    } else {
      calendarEvents = events || [];
    }

    let scheduleEvents: {
      id: string;
      title: string;
      start_at: string;
      end_at: string;
      location: string | null;
      status: string;
    }[] = [];

    const { data: scheduleData, error: scheduleError } = await supabase
      .from("schedule_events")
      .select("id, title, start_at, end_at, location, status")
      .eq("org_id", organizationId)
      .neq("status", "cancelled")
      .gte("start_at", start.toISOString())
      .lte("start_at", end.toISOString())
      .order("start_at", { ascending: true });

    if (scheduleError) {
      console.error("[calendar-org-events] Failed to fetch schedule events:", scheduleError);
    } else {
      scheduleEvents = scheduleData || [];
    }

    const normalizedCalendar = calendarEvents.map((event) => ({
      ...event,
      origin: "calendar" as const,
    }));

    const normalizedSchedule = scheduleEvents.map((event) => ({
      id: `schedule:${event.id}`,
      title: event.title,
      start_at: event.start_at,
      end_at: event.end_at,
      all_day: false,
      location: event.location,
      feed_id: null,
      origin: "schedule" as const,
    }));

    const combined = [...normalizedCalendar, ...normalizedSchedule].sort((a, b) => {
      return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
    });

    return NextResponse.json({ events: combined });
  } catch (error) {
    console.error("[calendar-org-events] Error fetching events:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to fetch events." },
      { status: 500 }
    );
  }
}
