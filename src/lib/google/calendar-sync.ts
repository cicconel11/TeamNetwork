import { google, calendar_v3 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
    getValidAccessToken,
} from "./oauth";

// Types for calendar events
export interface CalendarEvent {
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
}

export interface SyncResult {
    success: boolean;
    googleEventId?: string;
    error?: string;
}

// Event types that can be synced
export type EventType = "general" | "game" | "meeting" | "social" | "fundraiser" | "philanthropy";

// Sync operation types
export type SyncOperation = "create" | "update" | "delete";

/**
 * Checks if an error message indicates a 404 Not Found error
 * Used for missing event recovery (Requirement 3.3)
 */
export function isNotFoundError(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    return errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found");
}

/**
 * Creates a Google Calendar API client with the provided access token
 */
function createCalendarClient(accessToken: string): calendar_v3.Calendar {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.calendar({ version: "v3", auth });
}

/**
 * Creates a new event in the user's Google Calendar
 * @param accessToken - The user's Google access token
 * @param event - The calendar event data
 * @returns SyncResult with success status and google event ID
 * 
 * Requirements: 2.1, 2.2
 */
export async function createCalendarEvent(
    accessToken: string,
    event: CalendarEvent
): Promise<SyncResult> {
    try {
        const calendar = createCalendarClient(accessToken);

        const response = await calendar.events.insert({
            calendarId: "primary",
            requestBody: {
                summary: event.summary,
                description: event.description,
                location: event.location,
                start: event.start,
                end: event.end,
            },
        });

        if (!response.data.id) {
            return {
                success: false,
                error: "Google Calendar API did not return an event ID",
            };
        }

        return {
            success: true,
            googleEventId: response.data.id,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[calendar-sync] Failed to create calendar event:", errorMessage);
        return {
            success: false,
            error: errorMessage,
        };
    }
}

/**
 * Updates an existing event in the user's Google Calendar
 * @param accessToken - The user's Google access token
 * @param googleEventId - The Google Calendar event ID to update
 * @param event - The updated calendar event data
 * @returns SyncResult with success status, includes "404" in error if event not found
 * 
 * Requirements: 3.1, 3.2, 3.3
 */
export async function updateCalendarEvent(
    accessToken: string,
    googleEventId: string,
    event: CalendarEvent
): Promise<SyncResult> {
    try {
        const calendar = createCalendarClient(accessToken);

        await calendar.events.update({
            calendarId: "primary",
            eventId: googleEventId,
            requestBody: {
                summary: event.summary,
                description: event.description,
                location: event.location,
                start: event.start,
                end: event.end,
            },
        });

        return {
            success: true,
            googleEventId,
        };
    } catch (error: unknown) {
        // Check for 404 Not Found error (event was deleted from Google Calendar)
        const gaxiosError = error as { code?: number; status?: number; message?: string };
        const is404 = gaxiosError.code === 404 || gaxiosError.status === 404 ||
            (gaxiosError.message && gaxiosError.message.includes("404"));

        const errorMessage = is404
            ? "404: Event not found in Google Calendar"
            : (error instanceof Error ? error.message : "Unknown error");

        console.error("[calendar-sync] Failed to update calendar event:", errorMessage);
        return {
            success: false,
            error: errorMessage,
        };
    }
}

/**
 * Deletes an event from the user's Google Calendar
 * @param accessToken - The user's Google access token
 * @param googleEventId - The Google Calendar event ID to delete
 * @returns SyncResult with success status
 * 
 * Requirements: 4.1
 */
export async function deleteCalendarEvent(
    accessToken: string,
    googleEventId: string
): Promise<SyncResult> {
    try {
        const calendar = createCalendarClient(accessToken);

        await calendar.events.delete({
            calendarId: "primary",
            eventId: googleEventId,
        });

        return {
            success: true,
            googleEventId,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[calendar-sync] Failed to delete calendar event:", errorMessage);
        return {
            success: false,
            error: errorMessage,
        };
    }
}


/**
 * Maps an organization event to a Google Calendar event format
 * @param event - The organization event from the database
 * @returns CalendarEvent formatted for Google Calendar API
 * 
 * Requirements: 2.2
 * - summary equal to event.title
 * - description equal to event.description (if present)
 * - location equal to event.location (if present)
 * - start.dateTime equal to event.start_date
 * - end.dateTime equal to event.end_date (or start_date + 1 hour if no end_date)
 */
export function mapEventToCalendarEvent(event: {
    title: string;
    description?: string | null;
    location?: string | null;
    start_date: string;
    end_date?: string | null;
}): CalendarEvent {
    const startDate = new Date(event.start_date);

    // If no end_date, default to start_date + 1 hour
    let endDate: Date;
    if (event.end_date) {
        endDate = new Date(event.end_date);
    } else {
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // +1 hour
    }

    // Determine timezone - use UTC if not determinable from the date string
    const timeZone = "UTC";

    return {
        summary: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start: {
            dateTime: startDate.toISOString(),
            timeZone,
        },
        end: {
            dateTime: endDate.toISOString(),
            timeZone,
        },
    };
}


/**
 * Determines if a user should receive calendar sync for an event based on:
 * 1. User has a connected Google Calendar
 * 2. User is eligible based on event audience (members, alumni, both, or specific users)
 * 3. User has the event type enabled in their sync preferences
 * 
 * @param event - The organization event
 * @param user - The user to check eligibility for
 * @param connection - The user's calendar connection (if any)
 * @param preferences - The user's sync preferences (if any)
 * @param userRole - The user's role in the organization (member, alumni, etc.)
 * @returns true if the user should receive the calendar sync
 * 
 * Requirements: 2.5, 5.3
 */
export function isUserEligibleForSync(
    event: {
        audience?: string | null;
        target_user_ids?: string[] | null;
        event_type?: EventType | null;
    },
    userId: string,
    connection: { status: "connected" | "disconnected" | "error" } | null,
    preferences: {
        sync_general?: boolean | null;
        sync_game?: boolean | null;
        sync_meeting?: boolean | null;
        sync_social?: boolean | null;
        sync_fundraiser?: boolean | null;
        sync_philanthropy?: boolean | null;
    } | null,
    userRole: "member" | "alumni" | "admin" | null
): boolean {
    // 1. User must have a connected Google Calendar
    if (!connection || connection.status !== "connected") {
        return false;
    }

    // 2. Check audience eligibility
    const audience = event.audience || "all";
    const targetUserIds = event.target_user_ids || [];

    // If specific users are targeted, check if user is in the list
    if (targetUserIds.length > 0) {
        if (!targetUserIds.includes(userId)) {
            return false;
        }
    } else {
        // Check audience-based eligibility
        switch (audience) {
            case "members":
                if (userRole !== "member" && userRole !== "admin") {
                    return false;
                }
                break;
            case "alumni":
                if (userRole !== "alumni") {
                    return false;
                }
                break;
            case "all":
            case "both":
                // All users are eligible
                break;
            default:
                // Unknown audience, default to eligible
                break;
        }
    }

    // 3. Check sync preferences for event type
    const eventType = event.event_type || "general";

    // If no preferences exist, default to syncing all types
    if (!preferences) {
        return true;
    }

    // Check if the specific event type is enabled
    switch (eventType) {
        case "general":
            return preferences.sync_general !== false;
        case "game":
            return preferences.sync_game !== false;
        case "meeting":
            return preferences.sync_meeting !== false;
        case "social":
            return preferences.sync_social !== false;
        case "fundraiser":
            return preferences.sync_fundraiser !== false;
        case "philanthropy":
            return preferences.sync_philanthropy !== false;
        default:
            // Unknown event type, default to syncing
            return true;
    }
}

/**
 * Gets all eligible users for syncing an event
 * @param supabase - Supabase client
 * @param organizationId - The organization ID
 * @param event - The event to sync
 * @returns Array of user IDs eligible for sync
 * 
 * Requirements: 2.1, 2.5, 5.3
 */
export async function getEligibleUsersForEvent(
    supabase: SupabaseClient<Database>,
    organizationId: string,
    event: {
        audience?: string | null;
        target_user_ids?: string[] | null;
        event_type?: EventType | null;
    }
): Promise<string[]> {
    // Get all users with connected calendars in this organization
    const { data: connections, error: connError } = await supabase
        .from("user_calendar_connections")
        .select("user_id, status");

    if (connError || !connections) {
        console.error("[calendar-sync] Failed to fetch calendar connections:", connError);
        return [];
    }

    // Get connected user IDs
    const connectedUserIds = connections
        .filter(c => c.status === "connected")
        .map(c => c.user_id);

    if (connectedUserIds.length === 0) {
        return [];
    }

    // Get user roles from user_organization_roles
    const { data: orgUsers, error: orgError } = await supabase
        .from("user_organization_roles")
        .select("user_id, role")
        .eq("organization_id", organizationId)
        .in("user_id", connectedUserIds);

    if (orgError || !orgUsers) {
        console.error("[calendar-sync] Failed to fetch organization users:", orgError);
        return [];
    }

    // Get sync preferences for these users
    const { data: preferences, error: prefError } = await supabase
        .from("calendar_sync_preferences")
        .select("*")
        .eq("organization_id", organizationId)
        .in("user_id", connectedUserIds);

    if (prefError) {
        console.error("[calendar-sync] Failed to fetch sync preferences:", prefError);
        // Continue without preferences - will default to syncing all types
    }

    // Build lookup maps
    const connectionMap = new Map(connections.map(c => [c.user_id, c]));
    const roleMap = new Map(orgUsers.map(u => [u.user_id, u.role as "member" | "alumni" | "admin"]));
    const prefMap = new Map((preferences || []).map(p => [p.user_id, p]));

    // Filter to eligible users
    const eligibleUsers: string[] = [];

    for (const userId of connectedUserIds) {
        const connection = connectionMap.get(userId);
        const role = roleMap.get(userId) || null;
        const prefs = prefMap.get(userId) || null;

        // User must be in the organization
        if (!role) {
            continue;
        }

        if (isUserEligibleForSync(event, userId, connection || null, prefs, role)) {
            eligibleUsers.push(userId);
        }
    }

    return eligibleUsers;
}


/**
 * Syncs an organization event to all eligible users' Google Calendars
 * Handles create, update, and delete operations
 * 
 * @param supabase - Supabase client
 * @param organizationId - The organization ID
 * @param eventId - The event ID to sync
 * @param operation - The sync operation type (create, update, delete)
 * 
 * Requirements: 2.1, 2.3, 3.1, 4.1
 */
export async function syncEventToUsers(
    supabase: SupabaseClient<Database>,
    organizationId: string,
    eventId: string,
    operation: SyncOperation
): Promise<void> {
    // Fetch the event details
    const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

    if (eventError || !event) {
        console.error("[calendar-sync] Failed to fetch event:", eventError);
        return;
    }

    // For delete operations, we need to process existing entries
    if (operation === "delete") {
        await handleDeleteSync(supabase, eventId);
        return;
    }

    // Get eligible users for this event
    const eligibleUserIds = await getEligibleUsersForEvent(supabase, organizationId, {
        audience: event.audience,
        target_user_ids: event.target_user_ids,
        event_type: event.event_type as EventType | null,
    });

    if (eligibleUserIds.length === 0) {
        console.log("[calendar-sync] No eligible users for event:", eventId);
        return;
    }

    // Map the event to calendar format
    const calendarEvent = mapEventToCalendarEvent({
        title: event.title,
        description: event.description,
        location: event.location,
        start_date: event.start_date,
        end_date: event.end_date,
    });

    // Process each eligible user
    for (const userId of eligibleUserIds) {
        await syncEventForUser(supabase, userId, eventId, organizationId, calendarEvent, operation);
    }
}

/**
 * Syncs an event for a single user
 */
async function syncEventForUser(
    supabase: SupabaseClient<Database>,
    userId: string,
    eventId: string,
    organizationId: string,
    calendarEvent: CalendarEvent,
    operation: SyncOperation
): Promise<void> {
    // Get the user's access token
    const accessToken = await getValidAccessToken(supabase, userId);
    if (!accessToken) {
        console.warn("[calendar-sync] No valid access token for user:", userId);
        return;
    }

    // Check if there's an existing entry for this event/user
    const { data: existingEntry } = await supabase
        .from("event_calendar_entries")
        .select("*")
        .eq("event_id", eventId)
        .eq("user_id", userId)
        .single();

    if (operation === "create") {
        if (existingEntry && existingEntry.sync_status === "synced") {
            // Already synced, skip
            return;
        }

        const result = await createCalendarEvent(accessToken, calendarEvent);
        await updateSyncEntry(supabase, eventId, userId, organizationId, result);
    } else if (operation === "update") {
        if (!existingEntry) {
            // No existing entry, create new
            const result = await createCalendarEvent(accessToken, calendarEvent);
            await updateSyncEntry(supabase, eventId, userId, organizationId, result);
        } else {
            // Update existing entry
            const result = await updateCalendarEvent(accessToken, existingEntry.google_event_id, calendarEvent);

            // Handle 404 - event was deleted from Google Calendar (Requirement 3.3)
            if (!result.success && isNotFoundError(result.error)) {
                // Create new event and update entry with new google_event_id
                const createResult = await createCalendarEvent(accessToken, calendarEvent);
                await updateSyncEntry(supabase, eventId, userId, organizationId, createResult);
            } else {
                await updateSyncEntry(supabase, eventId, userId, organizationId, result, existingEntry.google_event_id);
            }
        }
    }
}

/**
 * Handles delete sync operation for all users with entries for this event
 * 
 * Graceful handling (Requirement 4.3):
 * - Deletion failures do NOT block the event deletion
 * - Errors are logged but processing continues for all users
 * - Entry status is updated regardless of success/failure
 */
async function handleDeleteSync(
    supabase: SupabaseClient<Database>,
    eventId: string
): Promise<void> {
    // Get all entries for this event
    const { data: entries, error } = await supabase
        .from("event_calendar_entries")
        .select("*")
        .eq("event_id", eventId)
        .neq("sync_status", "deleted");

    if (error || !entries || entries.length === 0) {
        return;
    }

    for (const entry of entries) {
        try {
            const accessToken = await getValidAccessToken(supabase, entry.user_id);
            if (!accessToken) {
                // Log but continue - graceful handling
                console.warn("[calendar-sync] No valid access token for user during delete:", entry.user_id);
                continue;
            }

            const result = await deleteCalendarEvent(accessToken, entry.google_event_id);

            // Update entry status regardless of success (graceful handling - Requirement 4.3)
            // Deletion failures are logged but do NOT throw or block
            if (!result.success) {
                console.warn("[calendar-sync] Failed to delete calendar event (graceful):", result.error);
            }

            await supabase
                .from("event_calendar_entries")
                .update({
                    sync_status: result.success ? "deleted" : "failed",
                    last_error: result.error || null,
                })
                .eq("id", entry.id);
        } catch (err) {
            // Catch any unexpected errors - graceful handling means we continue processing
            console.error("[calendar-sync] Unexpected error during delete sync (graceful):", err);
            // Continue to next entry - do not throw
        }
    }
}

/**
 * Updates or creates a sync entry in the database
 */
async function updateSyncEntry(
    supabase: SupabaseClient<Database>,
    eventId: string,
    userId: string,
    organizationId: string,
    result: SyncResult,
    existingGoogleEventId?: string
): Promise<void> {
    const googleEventId = result.googleEventId || existingGoogleEventId || "";

    if (!googleEventId && !result.success) {
        // Failed to create and no existing ID - log error
        console.error("[calendar-sync] Failed to sync event, no google_event_id:", result.error);
        return;
    }

    await supabase
        .from("event_calendar_entries")
        .upsert({
            event_id: eventId,
            user_id: userId,
            organization_id: organizationId,
            google_event_id: googleEventId,
            sync_status: result.success ? "synced" : "failed",
            last_error: result.error || null,
        }, {
            onConflict: "event_id,user_id",
        });
}
