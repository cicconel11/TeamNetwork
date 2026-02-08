import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * PUT /api/calendar/target
 *
 * Updates the user's target Google Calendar for event syncing.
 * Body: { targetCalendarId: string }
 */
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { targetCalendarId } = body;

    if (!targetCalendarId || typeof targetCalendarId !== "string") {
      return NextResponse.json(
        { error: "targetCalendarId is required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("user_calendar_connections")
      .update({ target_calendar_id: targetCalendarId })
      .eq("user_id", user.id);

    if (error) {
      console.error("[calendar-target] Error updating target calendar:", error);
      return NextResponse.json(
        { error: "Failed to update target calendar" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[calendar-target] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
