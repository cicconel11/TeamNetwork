import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleMicrosoftCalendarsGet } from "@/lib/microsoft/calendars";

export const dynamic = "force-dynamic";

/**
 * GET /api/microsoft/calendars
 *
 * Returns the authenticated user's Outlook Calendar list from Microsoft Graph API.
 * Returns calendars the user can read so both personal sync and team imports work.
 * If the user's token is missing or invalid, returns a 403 with { error: "reconnect_required" }.
 */
export async function GET(request: Request) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const modeParam = searchParams.get("mode");
        const mode = modeParam === "team_import" ? "team_import" : "personal";

        return handleMicrosoftCalendarsGet({
            supabase,
            serviceSupabase: createServiceClient(),
            userId: user.id,
            mode,
        });
    } catch (error) {
        console.error("[microsoft-calendars] Error listing calendars:", error);
        return NextResponse.json(
            { error: "Failed to list calendars" },
            { status: 500 }
        );
    }
}
