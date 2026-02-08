import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/calendars
 *
 * Returns the authenticated user's Google Calendar list.
 * Requires calendar.readonly scope. If the user's token lacks this scope,
 * returns a 403 with { error: "reconnect_required" }.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = await getValidAccessToken(supabase, user.id);
    if (!accessToken) {
      return NextResponse.json(
        { error: "Not connected to Google Calendar" },
        { status: 404 }
      );
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const calendarApi = google.calendar({ version: "v3", auth });

    const response = await calendarApi.calendarList.list({
      minAccessRole: "writer",
    });

    const calendars = (response.data.items || []).map((cal) => ({
      id: cal.id || "",
      summary: cal.summary || "",
      primary: cal.primary || false,
      backgroundColor: cal.backgroundColor || undefined,
    }));

    return NextResponse.json({ calendars });
  } catch (error) {
    // Check for insufficient scope (403)
    const gaxiosError = error as { code?: number; status?: number };
    if (gaxiosError.code === 403 || gaxiosError.status === 403) {
      return NextResponse.json(
        { error: "reconnect_required" },
        { status: 403 }
      );
    }

    console.error("[google-calendars] Error listing calendars:", error);
    return NextResponse.json(
      { error: "Failed to list calendars" },
      { status: 500 }
    );
  }
}
