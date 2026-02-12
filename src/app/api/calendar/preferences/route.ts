import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";

export const dynamic = "force-dynamic";

// Valid event types for sync preferences
const VALID_EVENT_TYPES = [
    "sync_general",
    "sync_game",
    "sync_meeting",
    "sync_social",
    "sync_fundraiser",
    "sync_philanthropy",
] as const;

type EventTypePreference = typeof VALID_EVENT_TYPES[number];

interface SyncPreferences {
    sync_general: boolean;
    sync_game: boolean;
    sync_meeting: boolean;
    sync_social: boolean;
    sync_fundraiser: boolean;
    sync_philanthropy: boolean;
}

/**
 * GET /api/calendar/preferences
 *
 * Retrieves the user's calendar sync preferences for a specific organization.
 *
 * Requirements: 5.1, 5.2
 * - Returns sync preference options for each event type
 */
export async function GET(request: Request) {
    try {
        // Get the authenticated user
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        const rateLimit = checkRateLimit(request, {
            userId: user?.id ?? null,
            feature: "calendar preferences",
            limitPerIp: 60,
            limitPerUser: 45,
        });

        if (!rateLimit.ok) {
            return buildRateLimitResponse(rateLimit);
        }

        const respond = (payload: unknown, status = 200) =>
            NextResponse.json(payload, { status, headers: rateLimit.headers });

        if (authError || !user) {
            return respond(
                { error: "Unauthorized", message: "You must be logged in to view preferences." },
                401
            );
        }

        // Get organization ID from query params
        const url = new URL(request.url);
        const organizationId = url.searchParams.get("organizationId");

        if (!organizationId) {
            return respond(
                { error: "Missing parameter", message: "organizationId is required." },
                400
            );
        }

        // Use regular client for membership check (RLS handles it)
        const { data: membership } = await supabase
            .from("user_organization_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .maybeSingle();

        if (!membership) {
            return respond(
                { error: "Forbidden", message: "You are not a member of this organization." },
                403
            );
        }

        // Get existing preferences using regular client
        const { data: preferences, error: prefError } = await supabase
            .from("calendar_sync_preferences")
            .select("*")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .maybeSingle();

        if (prefError) {
            console.error("[calendar-preferences] Error fetching preferences:", prefError);
            return respond(
                { error: "Database error", message: "Failed to fetch preferences." },
                500
            );
        }

        // Return preferences with defaults if not set
        const defaultPreferences: SyncPreferences = {
            sync_general: true,
            sync_game: true,
            sync_meeting: true,
            sync_social: true,
            sync_fundraiser: true,
            sync_philanthropy: true,
        };

        const responsePreferences: SyncPreferences = preferences
            ? {
                sync_general: preferences.sync_general ?? true,
                sync_game: preferences.sync_game ?? true,
                sync_meeting: preferences.sync_meeting ?? true,
                sync_social: preferences.sync_social ?? true,
                sync_fundraiser: preferences.sync_fundraiser ?? true,
                sync_philanthropy: preferences.sync_philanthropy ?? true,
            }
            : defaultPreferences;

        return respond({
            organizationId,
            preferences: responsePreferences,
            hasCustomPreferences: !!preferences,
        });

    } catch (error) {
        console.error("[calendar-preferences] Error getting preferences:", error);

        return NextResponse.json(
            { error: "Internal error", message: "An error occurred while fetching preferences." },
            { status: 500 }
        );
    }
}

/**
 * PUT /api/calendar/preferences
 *
 * Updates the user's calendar sync preferences for a specific organization.
 *
 * Requirements: 5.1, 5.2
 * - Allows users to enable or disable sync for each event type
 */
export async function PUT(request: Request) {
    try {
        // Get the authenticated user
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        const rateLimit = checkRateLimit(request, {
            userId: user?.id ?? null,
            feature: "calendar preferences update",
            limitPerIp: 30,
            limitPerUser: 20,
        });

        if (!rateLimit.ok) {
            return buildRateLimitResponse(rateLimit);
        }

        const respond = (payload: unknown, status = 200) =>
            NextResponse.json(payload, { status, headers: rateLimit.headers });

        if (authError || !user) {
            return respond(
                { error: "Unauthorized", message: "You must be logged in to update preferences." },
                401
            );
        }

        // Parse request body
        let body: { organizationId?: string; preferences?: Partial<SyncPreferences> };
        try {
            body = await request.json();
        } catch {
            return respond(
                { error: "Invalid request", message: "Request body must be valid JSON." },
                400
            );
        }

        const { organizationId, preferences } = body;

        if (!organizationId) {
            return respond(
                { error: "Missing parameter", message: "organizationId is required." },
                400
            );
        }

        if (!preferences || typeof preferences !== "object") {
            return respond(
                { error: "Missing parameter", message: "preferences object is required." },
                400
            );
        }

        // Validate preference keys
        const validatedPreferences: Partial<Record<EventTypePreference, boolean>> = {};
        for (const [key, value] of Object.entries(preferences)) {
            if (VALID_EVENT_TYPES.includes(key as EventTypePreference)) {
                if (typeof value === "boolean") {
                    validatedPreferences[key as EventTypePreference] = value;
                }
            }
        }

        if (Object.keys(validatedPreferences).length === 0) {
            return respond(
                { error: "Invalid preferences", message: "At least one valid preference must be provided." },
                400
            );
        }

        // Verify user is a member of the organization using regular client
        const { data: membership } = await supabase
            .from("user_organization_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .maybeSingle();

        if (!membership) {
            return respond(
                { error: "Forbidden", message: "You are not a member of this organization." },
                403
            );
        }

        // Block mutations if org is in grace period (read-only mode)
        const { isReadOnly } = await checkOrgReadOnly(organizationId);
        if (isReadOnly) {
            return respond(readOnlyResponse(), 403);
        }

        // Use service client for upsert (may need to bypass RLS for insert)
        const serviceClient = createServiceClient();

        // Upsert preferences
        const { data: updatedPreferences, error: upsertError } = await serviceClient
            .from("calendar_sync_preferences")
            .upsert({
                user_id: user.id,
                organization_id: organizationId,
                ...validatedPreferences,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: "user_id,organization_id",
            })
            .select()
            .single();

        if (upsertError) {
            console.error("[calendar-preferences] Error upserting preferences:", upsertError);
            return respond(
                { error: "Database error", message: "Failed to save preferences." },
                500
            );
        }

        // Return updated preferences
        const responsePreferences: SyncPreferences = {
            sync_general: updatedPreferences.sync_general ?? true,
            sync_game: updatedPreferences.sync_game ?? true,
            sync_meeting: updatedPreferences.sync_meeting ?? true,
            sync_social: updatedPreferences.sync_social ?? true,
            sync_fundraiser: updatedPreferences.sync_fundraiser ?? true,
            sync_philanthropy: updatedPreferences.sync_philanthropy ?? true,
        };

        return respond({
            success: true,
            organizationId,
            preferences: responsePreferences,
        });

    } catch (error) {
        console.error("[calendar-preferences] Error updating preferences:", error);

        return NextResponse.json(
            { error: "Internal error", message: "An error occurred while saving preferences." },
            { status: 500 }
        );
    }
}
