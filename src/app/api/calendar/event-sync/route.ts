import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncEventToUsers, SyncOperation } from "@/lib/google/calendar-sync";
import { baseSchemas } from "@/lib/security/validation";
import { requireActiveOrgAdmin } from "@/lib/auth/require-active-admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
    eventId: baseSchemas.uuid,
    organizationId: baseSchemas.uuid,
    operation: z.enum(["create", "update", "delete"]),
});

/**
 * POST /api/calendar/event-sync
 *
 * Triggers calendar synchronization for a specific event.
 * Caller must be an active admin of the org OR the event creator.
 * Event must belong to the supplied organizationId.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized", message: "You must be logged in to sync events." },
                { status: 401 }
            );
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Bad request", message: "Invalid sync request." },
                { status: 400 }
            );
        }
        const { eventId, organizationId, operation } = parsed.data;

        // Fetch event scoped to the supplied org (RLS scoped to caller).
        // 404 on miss prevents cross-org event ID enumeration.
        const { data: event } = await supabase
            .from("events")
            .select("id, organization_id, created_by_user_id")
            .eq("id", eventId)
            .eq("organization_id", organizationId)
            .maybeSingle();

        if (!event) {
            return NextResponse.json(
                { error: "Not found", message: "Event not found." },
                { status: 404 }
            );
        }

        // Authorize: active admin OR event creator.
        const isActiveAdmin = await requireActiveOrgAdmin(supabase, user.id, organizationId);
        const isCreator = event.created_by_user_id === user.id;
        if (!isActiveAdmin && !isCreator) {
            return NextResponse.json(
                { error: "Forbidden", message: "You cannot sync this event." },
                { status: 403 }
            );
        }

        const serviceClient = createServiceClient();

        await syncEventToUsers(serviceClient, organizationId, eventId, operation as SyncOperation);

        try {
            const { syncOutlookEventToUsers } = await import("@/lib/microsoft/calendar-sync");
            await syncOutlookEventToUsers(serviceClient, organizationId, eventId, operation as SyncOperation);
        } catch (outlookError) {
            console.error("[calendar-event-sync] Outlook sync error:", outlookError instanceof Error ? outlookError.message : outlookError);
        }

        return NextResponse.json({
            success: true,
            message: `Calendar sync triggered for event ${eventId} (${operation})`,
        });

    } catch (error) {
        console.error("[calendar-event-sync] Error:", error);

        return NextResponse.json({
            success: false,
            message: "Calendar sync encountered an error.",
        }, { status: 500 });
    }
}
