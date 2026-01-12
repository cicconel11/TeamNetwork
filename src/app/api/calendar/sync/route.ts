import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCalendarConnection } from "@/lib/google/oauth";
import { syncEventToUsers } from "@/lib/google/calendar-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/calendar/sync
 * 
 * Triggers manual synchronization of pending events for the authenticated user.
 * 
 * Requirements: 6.4
 * - Triggers sync for pending events
 * - Returns sync status
 */
export async function POST(request: Request) {
    try {
        // Get the authenticated user
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized", message: "You must be logged in to sync your calendar." },
                { status: 401 }
            );
        }

        // Use service client for database operations
        const serviceClient = createServiceClient();

        // Check if user has a connected calendar
        const connection = await getCalendarConnection(serviceClient, user.id);
        if (!connection || connection.status !== "connected") {
            return NextResponse.json(
                { error: "Not connected", message: "Please connect your Google Calendar first." },
                { status: 400 }
            );
        }

        // Parse request body for optional organization filter
        let organizationId: string | null = null;
        try {
            const body = await request.json();
            organizationId = body.organizationId || null;
        } catch {
            // No body or invalid JSON - sync all organizations
        }

        // Get pending/failed event entries for this user
        let query = serviceClient
            .from("event_calendar_entries")
            .select("event_id, organization_id")
            .eq("user_id", user.id)
            .in("sync_status", ["pending", "failed"]);

        if (organizationId) {
            query = query.eq("organization_id", organizationId);
        }

        const { data: pendingEntries, error: entriesError } = await query;

        if (entriesError) {
            console.error("[calendar-sync] Error fetching pending entries:", entriesError);
            return NextResponse.json(
                { error: "Database error", message: "Failed to fetch pending events." },
                { status: 500 }
            );
        }

        // Also get events that haven't been synced yet for this user
        // (events created after user connected their calendar)
        const { data: userOrgs } = await serviceClient
            .from("user_organization_roles")
            .select("organization_id")
            .eq("user_id", user.id);

        const orgIds = organizationId
            ? [organizationId]
            : (userOrgs?.map(o => o.organization_id) || []);

        let syncedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        // Sync pending entries
        for (const entry of pendingEntries || []) {
            try {
                await syncEventToUsers(serviceClient, entry.organization_id, entry.event_id, "update");
                syncedCount++;
            } catch (error) {
                failedCount++;
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                errors.push(`Event ${entry.event_id}: ${errorMessage}`);
            }
        }

        // Find events that haven't been synced to this user yet
        for (const orgId of orgIds) {
            // Get all active events for this organization
            const { data: events } = await serviceClient
                .from("events")
                .select("id")
                .eq("organization_id", orgId)
                .is("deleted_at", null);

            if (!events) continue;

            // Get existing entries for this user
            const { data: existingEntries } = await serviceClient
                .from("event_calendar_entries")
                .select("event_id")
                .eq("user_id", user.id)
                .eq("organization_id", orgId);

            const existingEventIds = new Set(existingEntries?.map(e => e.event_id) || []);

            // Sync events that don't have entries yet
            for (const event of events) {
                if (!existingEventIds.has(event.id)) {
                    try {
                        await syncEventToUsers(serviceClient, orgId, event.id, "create");
                        syncedCount++;
                    } catch (error) {
                        failedCount++;
                        const errorMessage = error instanceof Error ? error.message : "Unknown error";
                        errors.push(`Event ${event.id}: ${errorMessage}`);
                    }
                }
            }
        }

        // Update last_sync_at timestamp
        await serviceClient
            .from("user_calendar_connections")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("user_id", user.id);

        return NextResponse.json({
            success: true,
            message: `Sync completed. ${syncedCount} events synced, ${failedCount} failed.`,
            syncedCount,
            failedCount,
            errors: errors.length > 0 ? errors : undefined,
        });

    } catch (error) {
        console.error("[calendar-sync] Error during manual sync:", error);

        return NextResponse.json(
            { error: "Internal error", message: "An error occurred while syncing your calendar." },
            { status: 500 }
        );
    }
}

/**
 * GET /api/calendar/sync
 * 
 * Returns the current sync status for the authenticated user.
 */
export async function GET() {
    try {
        // Get the authenticated user
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized", message: "You must be logged in to check sync status." },
                { status: 401 }
            );
        }

        // Use service client for database operations
        const serviceClient = createServiceClient();

        // Get connection status
        const connection = await getCalendarConnection(serviceClient, user.id);
        if (!connection) {
            return NextResponse.json({
                connected: false,
                message: "Google Calendar not connected.",
            });
        }

        // Get sync statistics
        const { data: entries, error: entriesError } = await serviceClient
            .from("event_calendar_entries")
            .select("sync_status")
            .eq("user_id", user.id);

        if (entriesError) {
            console.error("[calendar-sync] Error fetching entries:", entriesError);
        }

        const stats = {
            synced: 0,
            pending: 0,
            failed: 0,
            deleted: 0,
        };

        for (const entry of entries || []) {
            const status = entry.sync_status as keyof typeof stats;
            if (status in stats) {
                stats[status]++;
            }
        }

        return NextResponse.json({
            connected: true,
            status: connection.status,
            googleEmail: connection.googleEmail,
            lastSyncAt: connection.lastSyncAt?.toISOString() || null,
            stats,
        });

    } catch (error) {
        console.error("[calendar-sync] Error getting sync status:", error);

        return NextResponse.json(
            { error: "Internal error", message: "An error occurred while checking sync status." },
            { status: 500 }
        );
    }
}
