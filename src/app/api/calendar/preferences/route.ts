import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized", message: "You must be logged in to view preferences." },
                { status: 401 }
            );
        }

        // Get organization ID from query params
        const url = new URL(request.url);
        const organizationId = url.searchParams.get("organizationId");

        if (!organizationId) {
            return NextResponse.json(
                { error: "Missing parameter", message: "organizationId is required." },
                { status: 400 }
            );
        }

        // Use service client for database operations
        const serviceClient = createServiceClient();

        // Verify user is a member of the organization
        const { data: membership } = await serviceClient
            .from("user_organization_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .single();

        if (!membership) {
            return NextResponse.json(
                { error: "Forbidden", message: "You are not a member of this organization." },
                { status: 403 }
            );
        }

        // Get existing preferences
        const { data: preferences, error: prefError } = await serviceClient
            .from("calendar_sync_preferences")
            .select("*")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .single();

        if (prefError && prefError.code !== "PGRST116") {
            // PGRST116 = no rows returned, which is fine
            console.error("[calendar-preferences] Error fetching preferences:", prefError);
            return NextResponse.json(
                { error: "Database error", message: "Failed to fetch preferences." },
                { status: 500 }
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

        return NextResponse.json({
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

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized", message: "You must be logged in to update preferences." },
                { status: 401 }
            );
        }

        // Parse request body
        let body: { organizationId?: string; preferences?: Partial<SyncPreferences> };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid request", message: "Request body must be valid JSON." },
                { status: 400 }
            );
        }

        const { organizationId, preferences } = body;

        if (!organizationId) {
            return NextResponse.json(
                { error: "Missing parameter", message: "organizationId is required." },
                { status: 400 }
            );
        }

        if (!preferences || typeof preferences !== "object") {
            return NextResponse.json(
                { error: "Missing parameter", message: "preferences object is required." },
                { status: 400 }
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
            return NextResponse.json(
                { error: "Invalid preferences", message: "At least one valid preference must be provided." },
                { status: 400 }
            );
        }

        // Use service client for database operations
        const serviceClient = createServiceClient();

        // Verify user is a member of the organization
        const { data: membership } = await serviceClient
            .from("user_organization_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .single();

        if (!membership) {
            return NextResponse.json(
                { error: "Forbidden", message: "You are not a member of this organization." },
                { status: 403 }
            );
        }

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
            return NextResponse.json(
                { error: "Database error", message: "Failed to save preferences." },
                { status: 500 }
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

        return NextResponse.json({
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
