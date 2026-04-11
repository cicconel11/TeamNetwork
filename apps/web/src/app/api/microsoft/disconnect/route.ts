import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { disconnectMicrosoft } from "@/lib/microsoft/oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/microsoft/disconnect
 *
 * Disconnects a user's Outlook Calendar by removing the local connection record.
 *
 * - Removes user_calendar_connections record
 * - Cleans up related event_calendar_entries
 * - Cleans up related personal feeds and team schedule sources
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
        const result = await disconnectMicrosoft(serviceClient, user.id);

        if (!result.success) {
            return NextResponse.json(
                { error: "Disconnect failed", message: result.error || "Failed to disconnect Outlook Calendar." },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Outlook Calendar disconnected successfully.",
        });

    } catch (error) {
        console.error("[microsoft-disconnect] Error disconnecting calendar:", error);

        return NextResponse.json(
            { error: "Internal error", message: "An error occurred while disconnecting your Outlook Calendar." },
            { status: 500 }
        );
    }
}
