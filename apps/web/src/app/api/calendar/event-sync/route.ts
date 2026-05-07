import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncEventToUsers, SyncOperation } from "@/lib/google/calendar-sync";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { authorizeEventSync } from "@/lib/calendar/event-sync-authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

        // Rate limit before any external sync work. Caps both anonymous
        // probing (per IP) and authenticated abuse (per user).
        const rateLimit = checkRateLimit(request, {
            userId: user?.id ?? null,
            feature: "calendar event-sync",
            limitPerIp: 60,
            limitPerUser: 30,
        });
        if (!rateLimit.ok) {
            return buildRateLimitResponse(rateLimit);
        }

        const respond = (payload: unknown, status = 200) =>
            NextResponse.json(payload, { status, headers: rateLimit.headers });

        if (authError || !user) {
            return respond(
                { error: "Unauthorized", message: "You must be logged in to sync events." },
                401
            );
        }

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
            return respond(
                { error: "Bad request", message: "Invalid sync request." },
                400
            );
        }
        const { eventId, organizationId, operation } = parsed.data;

        const authz = await authorizeEventSync({
            client: supabase,
            userId: user.id,
            eventId,
            organizationId,
        });
        if (!authz.ok) {
            if (authz.status === 404) {
                return respond({ error: "Not found", message: "Event not found." }, 404);
            }
            return respond({ error: "Forbidden", message: "You cannot sync this event." }, 403);
        }

        const serviceClient = createServiceClient();

        await syncEventToUsers(serviceClient, organizationId, eventId, operation as SyncOperation);

        try {
            const { syncOutlookEventToUsers } = await import("@/lib/microsoft/calendar-sync");
            await syncOutlookEventToUsers(serviceClient, organizationId, eventId, operation as SyncOperation);
        } catch (outlookError) {
            console.error("[calendar-event-sync] Outlook sync error:", outlookError instanceof Error ? outlookError.message : outlookError);
        }

        return respond({
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
