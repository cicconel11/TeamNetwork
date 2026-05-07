import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { disconnectCalendar } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/google/disconnect
 * 
 * Disconnects a user's Google Calendar by revoking tokens and removing
 * the connection record.
 * 
 * Requirements: 1.6
 * - Revokes stored OAuth tokens with Google
 * - Removes user_calendar_connections record
 * - Cleans up related event_calendar_entries
 */
export async function POST() {
    try {
        // Get the authenticated user
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized", message: "You must be logged in to disconnect your calendar." },
                { status: 401 }
            );
        }

        // Use service client to bypass RLS for deletion
        const serviceClient = createServiceClient();
        const result = await disconnectCalendar(serviceClient, user.id);

        if (!result.success) {
            return NextResponse.json(
                { error: "Disconnect failed", message: result.error || "Failed to disconnect Google Calendar." },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Google Calendar disconnected successfully.",
        });

    } catch (error) {
        console.error("[google-disconnect] Error disconnecting calendar:", error);

        return NextResponse.json(
            { error: "Internal error", message: "An error occurred while disconnecting your Google Calendar." },
            { status: 500 }
        );
    }
}
