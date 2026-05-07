import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOutlookEntriesToSync } from "@/lib/calendar/manual-sync";
import { getCalendarConnection } from "@/lib/google/oauth";
import { syncOutlookEventToUsers } from "@/lib/microsoft/calendar-sync";
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

        // Parse request body for optional organization filter
        let organizationId: string | null = null;
        try {
            const body = await request.json();
            organizationId = body.organizationId || null;
        } catch {
            // No body or invalid JSON - sync all organizations
        }

        const [googleConnection, outlookConnectionResult, userOrgsResult] = await Promise.all([
            getCalendarConnection(serviceClient, user.id),
            serviceClient
                .from("user_calendar_connections")
                .select("id, status, target_calendar_id")
                .eq("user_id", user.id)
                .eq("provider", "outlook")
                .eq("status", "connected")
                .maybeSingle(),
            serviceClient
                .from("user_organization_roles")
                .select("organization_id")
                .eq("user_id", user.id),
        ]);

        const hasGoogleConnection = !!googleConnection && googleConnection.status === "connected";
        const hasOutlookConnection = !!outlookConnectionResult.data;

        if (!hasGoogleConnection && !hasOutlookConnection) {
            return NextResponse.json(
                { error: "Not connected", message: "Please connect a calendar first." },
                { status: 400 }
            );
        }

        const orgIds = organizationId
            ? [organizationId]
            : (userOrgsResult.data?.map((org) => org.organization_id) || []);

        let syncedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        if (hasGoogleConnection && googleConnection) {
            try {
                // Get pending/failed event entries for this user
                let query = serviceClient
                    .from("event_calendar_entries")
                    .select("event_id, organization_id")
                    .eq("user_id", user.id)
                    .eq("provider", "google")
                    .in("sync_status", ["pending", "failed"]);

                if (organizationId) {
                    query = query.eq("organization_id", organizationId);
                }

                const { data: pendingEntries, error: entriesError } = await query;

                if (entriesError) {
                    console.error("[calendar-sync] Error fetching Google pending entries:", entriesError);
                    return NextResponse.json(
                        { error: "Database error", message: "Failed to fetch pending events." },
                        { status: 500 }
                    );
                }

                // Get synced entries whose google_calendar_id differs from the user's
                // current target calendar. These need reprocessing so the existing
                // mismatch detection in syncEventForUser can migrate them.
                const targetCalendarId = googleConnection.targetCalendarId || "primary";
                let mismatchQuery = serviceClient
                    .from("event_calendar_entries")
                    .select("event_id, organization_id")
                    .eq("user_id", user.id)
                    .eq("provider", "google")
                    .eq("sync_status", "synced")
                    .neq("external_calendar_id", targetCalendarId);

                if (organizationId) {
                    mismatchQuery = mismatchQuery.eq("organization_id", organizationId);
                }

                const { data: mismatchedEntries } = await mismatchQuery;

                // Merge pending/failed entries with mismatched entries for processing.
                // No dedup needed: pending/failed and synced are mutually exclusive statuses.
                const allEntriesToSync = [
                    ...(pendingEntries || []),
                    ...(mismatchedEntries || []),
                ];

                for (const entry of allEntriesToSync) {
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
                    const { data: events } = await serviceClient
                        .from("events")
                        .select("id")
                        .eq("organization_id", orgId)
                        .is("deleted_at", null);

                    if (!events) continue;

                    const { data: existingEntries } = await serviceClient
                        .from("event_calendar_entries")
                        .select("event_id")
                        .eq("user_id", user.id)
                        .eq("organization_id", orgId)
                        .eq("provider", "google");

                    const existingEventIds = new Set(existingEntries?.map((entry) => entry.event_id) || []);

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

                await serviceClient
                    .from("user_calendar_connections")
                    .update({ last_sync_at: new Date().toISOString() })
                    .eq("user_id", user.id)
                    .eq("provider", "google");
            } catch (googleSyncError) {
                console.error(
                    "[calendar-sync] Google sync block error:",
                    googleSyncError instanceof Error ? googleSyncError.message : googleSyncError
                );
            }
        }

        // Sync Outlook events for connected members (isolated — does not affect Google sync result)
        try {
            const outlookConnection = outlookConnectionResult.data;

            if (outlookConnection) {
                const allOutlookEntriesToSync = await getOutlookEntriesToSync(
                    serviceClient,
                    user.id,
                    outlookConnection.target_calendar_id,
                    organizationId
                );

                // Sync pending/failed and mismatched Outlook entries
                for (const entry of allOutlookEntriesToSync) {
                    try {
                        await syncOutlookEventToUsers(serviceClient, entry.organization_id, entry.event_id, "update");
                        syncedCount++;
                    } catch (err) {
                        failedCount++;
                        const msg = err instanceof Error ? err.message : "Unknown error";
                        errors.push(`[Outlook] Event ${entry.event_id}: ${msg}`);
                    }
                }

                // Find unsynced events for Outlook
                for (const orgId of orgIds) {
                    const { data: events } = await serviceClient
                        .from("events")
                        .select("id")
                        .eq("organization_id", orgId)
                        .is("deleted_at", null);

                    if (!events) continue;

                    const { data: existingOutlookEntries } = await serviceClient
                        .from("event_calendar_entries")
                        .select("event_id")
                        .eq("user_id", user.id)
                        .eq("organization_id", orgId)
                        .eq("provider", "outlook");

                    const existingOutlookEventIds = new Set(existingOutlookEntries?.map(e => e.event_id) || []);

                    for (const event of events) {
                        if (!existingOutlookEventIds.has(event.id)) {
                            try {
                                await syncOutlookEventToUsers(serviceClient, orgId, event.id, "create");
                                syncedCount++;
                            } catch (err) {
                                failedCount++;
                                const msg = err instanceof Error ? err.message : "Unknown error";
                                errors.push(`[Outlook] Event ${event.id}: ${msg}`);
                            }
                        }
                    }
                }

                // Update last_sync_at for the Outlook connection
                await serviceClient
                    .from("user_calendar_connections")
                    .update({ last_sync_at: new Date().toISOString() })
                    .eq("user_id", user.id)
                    .eq("provider", "outlook");
            }
        } catch (outlookSyncError) {
            console.error("[calendar-sync] Outlook sync block error:", outlookSyncError instanceof Error ? outlookSyncError.message : outlookSyncError);
        }

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

        // Get Google connection status
        const connection = await getCalendarConnection(serviceClient, user.id);

        // Get Outlook connection status
        const { data: outlookConn } = await serviceClient
            .from("user_calendar_connections")
            .select("status, provider_email, last_sync_at")
            .eq("user_id", user.id)
            .eq("provider", "outlook")
            .maybeSingle();

        if (!connection && !outlookConn) {
            return NextResponse.json({
                connected: false,
                message: "No calendar connected.",
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
            google: connection
                ? {
                    status: connection.status,
                    email: connection.providerEmail,
                    lastSyncAt: connection.lastSyncAt?.toISOString() || null,
                }
                : null,
            outlook: outlookConn
                ? {
                    status: outlookConn.status,
                    email: outlookConn.provider_email ?? null,
                    lastSyncAt: outlookConn.last_sync_at ?? null,
                }
                : null,
            // Legacy fields kept for backwards compatibility
            status: connection?.status ?? outlookConn?.status ?? null,
            googleEmail: connection?.providerEmail ?? null,
            lastSyncAt: connection?.lastSyncAt?.toISOString() || outlookConn?.last_sync_at || null,
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
