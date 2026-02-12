import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google/oauth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

type GoogleCalendarListItem = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
};

type GoogleCalendarListResponse = {
  items?: GoogleCalendarListItem[];
};

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");

    if (!orgId) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId is required." },
        { status: 400 }
      );
    }

    // Check admin role
    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can manage schedule sources." },
        { status: 403 }
      );
    }

    // Check for connected Google account
    const serviceClient = createServiceClient();
    const accessToken = await getValidAccessToken(serviceClient, user.id);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Not connected", message: "No Google account connected. Please connect your Google account first." },
        { status: 404 }
      );
    }

    // Fetch calendar list from Google
    const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Google API error", message: "Failed to fetch calendar list from Google." },
        { status: 500 }
      );
    }

    const data: GoogleCalendarListResponse = await response.json();
    const calendars = (data.items ?? []).map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary ?? false,
    }));

    return NextResponse.json({ calendars });
  } catch (error) {
    console.error("[schedules/google/calendars] Error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to list Google calendars." },
      { status: 500 }
    );
  }
}
