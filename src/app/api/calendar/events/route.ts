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
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: "Missing parameters", message: "start and end are required." },
        { status: 400 }
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

    const { data: events, error } = await supabase
      .from("calendar_events")
      .select("id, title, start_at, end_at, location, feed_id")
      .eq("user_id", user.id)
      .gte("start_at", start.toISOString())
      .lte("start_at", end.toISOString())
      .order("start_at", { ascending: true });

    if (error) {
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
