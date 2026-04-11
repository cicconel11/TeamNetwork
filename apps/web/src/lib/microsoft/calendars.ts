import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
    getMicrosoftValidAccessToken,
    markMicrosoftConnectionReconnectRequired,
} from "@/lib/microsoft/oauth";

type MicrosoftCalendarApiRow = {
    id: string;
    name: string;
    isDefaultCalendar: boolean;
    canEdit: boolean;
    hexColor: string;
};

export type MicrosoftCalendarsMode = "personal" | "team_import";

type MicrosoftCalendarsHandlerDeps = {
    supabase: SupabaseClient<Database>;
    serviceSupabase: SupabaseClient<Database>;
    userId: string;
    mode?: MicrosoftCalendarsMode;
    getAccessToken?: typeof getMicrosoftValidAccessToken;
    fetchImpl?: typeof fetch;
};

function isReconnectRequiredGraphStatus(status: number): boolean {
    return status === 401 || status === 403;
}

function normalizeMicrosoftCalendars(
    calendars: MicrosoftCalendarApiRow[],
    mode: MicrosoftCalendarsMode
) {
    return calendars
        .filter((calendar) => calendar.id && calendar.name)
        .filter((calendar) => mode === "team_import" || calendar.canEdit)
        .map((calendar) => ({
            id: calendar.id,
            name: calendar.name,
            isDefault: calendar.isDefaultCalendar,
            hexColor: calendar.hexColor === "" ? undefined : calendar.hexColor,
        }));
}

export async function handleMicrosoftCalendarsGet({
    supabase,
    serviceSupabase,
    userId,
    mode = "personal",
    getAccessToken = getMicrosoftValidAccessToken,
    fetchImpl = fetch,
}: MicrosoftCalendarsHandlerDeps) {
    const accessToken = await getAccessToken(supabase, userId);
    if (!accessToken) {
        return NextResponse.json(
            { error: "reconnect_required" },
            { status: 403 }
        );
    }

    const response = await fetchImpl("https://graph.microsoft.com/v1.0/me/calendars", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        if (isReconnectRequiredGraphStatus(response.status)) {
            await markMicrosoftConnectionReconnectRequired(serviceSupabase, userId);
            return NextResponse.json(
                { error: "reconnect_required" },
                { status: 403 }
            );
        }

        console.error("[microsoft-calendars] Graph API error:", response.status, response.statusText);
        return NextResponse.json(
            { error: "Failed to list calendars" },
            { status: 500 }
        );
    }

    const data = await response.json() as { value?: MicrosoftCalendarApiRow[] };
    return NextResponse.json({
        calendars: normalizeMicrosoftCalendars(data.value || [], mode),
    });
}
