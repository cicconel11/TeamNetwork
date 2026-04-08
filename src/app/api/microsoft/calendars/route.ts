import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMicrosoftValidAccessToken } from "@/lib/microsoft/oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/microsoft/calendars
 *
 * Returns the authenticated user's Outlook Calendar list from Microsoft Graph API.
 * Filters to calendars where the user has edit access.
 * If the user's token is missing or invalid, returns a 403 with { error: "reconnect_required" }.
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

        const accessToken = await getMicrosoftValidAccessToken(supabase, user.id);
        if (!accessToken) {
            return NextResponse.json(
                { error: "reconnect_required" },
                { status: 403 }
            );
        }

        const response = await fetch("https://graph.microsoft.com/v1.0/me/calendars", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            console.error("[microsoft-calendars] Graph API error:", response.status, response.statusText);
            return NextResponse.json(
                { error: "Failed to list calendars" },
                { status: 500 }
            );
        }

        const data = await response.json() as {
            value: Array<{
                id: string;
                name: string;
                isDefaultCalendar: boolean;
                canEdit: boolean;
                hexColor: string;
            }>;
        };

        const calendars = (data.value || [])
            .filter((cal) => cal.canEdit === true)
            .map((cal) => ({
                id: cal.id,
                name: cal.name,
                isDefault: cal.isDefaultCalendar,
                hexColor: cal.hexColor === "" ? undefined : cal.hexColor,
            }));

        return NextResponse.json({ calendars });
    } catch (error) {
        console.error("[microsoft-calendars] Error listing calendars:", error);
        return NextResponse.json(
            { error: "Failed to list calendars" },
            { status: 500 }
        );
    }
}
