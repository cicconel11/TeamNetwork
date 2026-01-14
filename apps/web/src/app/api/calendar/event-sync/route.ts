import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncEventToUsers, SyncOperation } from "@/lib/google/calendar-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/calendar/event-sync
 * 
 * Triggers calendar synchronization for a specific event.
 * Called automatically when events are created, updated, or deleted.
 * 
 * Request body:
 * - eventId: string - The event ID to sync
 * - organizationId: string - The organization ID
 * - operation: "create" | "update" | "delete" - The sync operation type
 * 
 * Requirements: 2.1, 3.1, 4.1
 */
export async function POST(request: Request) {
    try {
        // Get the authenticated user
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized", message: "You must be logged in to sync events." },
                { status: 401 }
            );
        }

        // Parse request body
        const body = await request.json();
        const { eventId, organizationId, operation } = body as {
            eventId: string;
            organizationId: string;
            operation: SyncOperation;
        };

        if (!eventId || !organizationId || !operation) {
            return NextResponse.json(
                { error: "Bad request", message: "Missing required fields: eventId, organizationId, operation" },
                { status: 400 }
            );
        }

        if (!["create", "update", "delete"].includes(operation)) {
            return NextResponse.json(
                { error: "Bad request", message: "Invalid operation. Must be create, update, or delete." },
                { status: 400 }
            );
        }

        // Verify user has access to this organization
        const { data: membership, error: membershipError } = await supabase
            .from("user_organization_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .single();

        if (membershipError || !membership) {
            return NextResponse.json(
                { error: "Forbidden", message: "You do not have access to this organization." },
                { status: 403 }
            );
        }

        // Use service client for sync operations (needs elevated permissions)
        const serviceClient = createServiceClient();

        // Trigger the sync operation
        await syncEventToUsers(serviceClient, organizationId, eventId, operation);

        return NextResponse.json({
            success: true,
            message: `Calendar sync triggered for event ${eventId} (${operation})`,
        });

    } catch (error) {
        console.error("[calendar-event-sync] Error:", error);

        // Don't fail the request - calendar sync errors should not block event operations
        return NextResponse.json({
            success: false,
            message: "Calendar sync encountered an error but event operation completed.",
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
}
