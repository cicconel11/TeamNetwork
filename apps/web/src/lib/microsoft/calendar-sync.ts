import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
    getMicrosoftValidAccessToken,
    getMicrosoftConnection,
} from "./oauth";
import type { MicrosoftCalendarEvent } from "./calendar-event-mapper";
import { mapEventToMicrosoftCalendarEvent } from "./calendar-event-mapper";
import { graphFetch, GraphNotFoundError } from "./graph-fetch";
export type { MicrosoftCalendarEvent };
export { mapEventToMicrosoftCalendarEvent };

export interface MicrosoftSyncResult {
    success: boolean;
    externalEventId?: string;
    error?: string;
}

export const DEFAULT_OUTLOOK_SYNC_CONCURRENCY = 5;
export const DEFAULT_OUTLOOK_SYNC_CALENDAR_ID = "primary";

// Event types that can be synced
export type EventType =
    | "general"
    | "game"
    | "meeting"
    | "social"
    | "fundraiser"
    | "philanthropy"
    | "practice"
    | "workout";

// Sync operation types
export type SyncOperation = "create" | "update" | "delete";

export function normalizeOutlookTargetCalendarId(targetCalendarId?: string | null): string | undefined {
    if (!targetCalendarId || targetCalendarId === DEFAULT_OUTLOOK_SYNC_CALENDAR_ID) {
        return undefined;
    }
    return targetCalendarId;
}

export function getStoredOutlookCalendarId(targetCalendarId?: string | null): string {
    return normalizeOutlookTargetCalendarId(targetCalendarId) ?? DEFAULT_OUTLOOK_SYNC_CALENDAR_ID;
}

export async function runWithConcurrencyLimit<T>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>
): Promise<PromiseSettledResult<void>[]> {
    const concurrency = Math.max(1, Math.min(limit, items.length || 1));
    const results: PromiseSettledResult<void>[] = new Array(items.length);
    let nextIndex = 0;

    const runners = Array.from({ length: concurrency }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex++;

            try {
                await worker(items[currentIndex], currentIndex);
                results[currentIndex] = { status: "fulfilled", value: undefined };
            } catch (error) {
                results[currentIndex] = { status: "rejected", reason: error };
            }
        }
    });

    await Promise.all(runners);
    return results;
}

/**
 * Checks if an error message indicates a 404 Not Found error
 */
export function isNotFoundError(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    return errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found");
}

/**
 * Creates a new event in the user's Outlook calendar via Microsoft Graph
 * If calendarId is null/undefined, uses /me/events to write to the user's default calendar
 * Otherwise uses /me/calendars/{calendarId}/events for a specific calendar
 */
export async function createOutlookCalendarEvent(
    accessToken: string,
    event: MicrosoftCalendarEvent,
    calendarId?: string
): Promise<MicrosoftSyncResult> {
    try {
        const normalizedCalendarId = normalizeOutlookTargetCalendarId(calendarId);
        const path = !normalizedCalendarId
            ? "/me/events"
            : `/me/calendars/${normalizedCalendarId}/events`;

        const response = await graphFetch(path, accessToken, {
            method: "POST",
            body: JSON.stringify(event),
        });

        const data = await response.json() as { id?: string };

        if (!data.id) {
            return { success: false, error: "Microsoft Graph API did not return an event ID" };
        }

        return { success: true, externalEventId: data.id };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[microsoft-calendar-sync] Failed to create event:", errorMessage);
        return { success: false, error: errorMessage };
    }
}

/**
 * Updates an existing event in the user's Outlook calendar via Microsoft Graph
 * Note: uses /me/events/{id} (not /me/calendars/{id}/events/{id})
 */
export async function updateOutlookCalendarEvent(
    accessToken: string,
    eventId: string,
    event: MicrosoftCalendarEvent
): Promise<MicrosoftSyncResult> {
    try {
        await graphFetch(`/me/events/${eventId}`, accessToken, {
            method: "PATCH",
            body: JSON.stringify(event),
        });

        return { success: true, externalEventId: eventId };
    } catch (error) {
        if (error instanceof GraphNotFoundError) {
            return { success: false, error: "404: Not Found" };
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[microsoft-calendar-sync] Failed to update event:", errorMessage);
        return { success: false, error: errorMessage };
    }
}

/**
 * Deletes an event from the user's Outlook calendar via Microsoft Graph
 * Handles 404 silently (event already deleted by user)
 */
export async function deleteOutlookCalendarEvent(
    accessToken: string,
    eventId: string
): Promise<MicrosoftSyncResult> {
    try {
        await graphFetch(`/me/events/${eventId}`, accessToken, {
            method: "DELETE",
        });

        return { success: true };
    } catch (error) {
        if (error instanceof GraphNotFoundError) {
            // Already deleted — treat as success
            return { success: true };
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error("[microsoft-calendar-sync] Failed to delete event:", errorMessage);
        return { success: false, error: errorMessage };
    }
}

/**
 * Checks if a user is eligible for Outlook sync given event attributes and connection state.
 * Mirrors isUserEligibleForSync from Google calendar-sync.
 */
export function isUserEligibleForOutlookSync(
    event: {
        audience?: string | null;
        target_user_ids?: string[] | null;
        event_type?: EventType | null;
    },
    userId: string,
    connection: { status: string | null } | null,
    preferences: {
        sync_general?: boolean | null;
        sync_game?: boolean | null;
        sync_meeting?: boolean | null;
        sync_social?: boolean | null;
        sync_fundraiser?: boolean | null;
        sync_philanthropy?: boolean | null;
        sync_practice?: boolean | null;
        sync_workout?: boolean | null;
    } | null,
    userRole: "member" | "active_member" | "alumni" | "admin" | null
): boolean {
    // 1. User must have a connected Outlook calendar
    if (!connection || connection.status !== "connected") {
        return false;
    }

    // 2. Check audience eligibility
    const audience = event.audience || "all";
    const targetUserIds = event.target_user_ids || [];

    if (targetUserIds.length > 0) {
        if (!targetUserIds.includes(userId)) {
            return false;
        }
    } else {
        switch (audience) {
            case "members":
                if (userRole !== "member" && userRole !== "active_member" && userRole !== "admin") {
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
                break;
            default:
                break;
        }
    }

    // 3. Check sync preferences for event type
    const eventType = event.event_type || "general";

    if (!preferences) {
        return true;
    }

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
        case "practice":
            return preferences.sync_practice !== false;
        case "workout":
            return preferences.sync_workout !== false;
        default:
            return true;
    }
}

/**
 * Gets all eligible users for Outlook syncing an event
 */
export async function getEligibleUsersForOutlookSync(
    supabase: SupabaseClient<Database>,
    organizationId: string,
    event: {
        audience?: string | null;
        target_user_ids?: string[] | null;
        event_type?: EventType | null;
    }
): Promise<string[]> {
    const { data: orgUsers, error: orgError } = await supabase
        .from("user_organization_roles")
        .select("user_id, role")
        .eq("organization_id", organizationId);

    if (orgError || !orgUsers) {
        console.error("[microsoft-calendar-sync] Failed to fetch organization users:", orgError);
        return [];
    }

    const orgUserIds = orgUsers.map(u => u.user_id);
    if (orgUserIds.length === 0) {
        return [];
    }

    const { data: connections, error: connError } = await supabase
        .from("user_calendar_connections")
        .select("user_id, status")
        .in("user_id", orgUserIds)
        .eq("provider", "outlook");

    if (connError || !connections) {
        console.error("[microsoft-calendar-sync] Failed to fetch Outlook connections:", connError);
        return [];
    }

    const connectedUserIds = connections
        .filter(c => c.status === "connected")
        .map(c => c.user_id);

    if (connectedUserIds.length === 0) {
        return [];
    }

    const { data: preferences } = await supabase
        .from("calendar_sync_preferences")
        .select("*")
        .eq("organization_id", organizationId)
        .in("user_id", connectedUserIds);

    const connectionMap = new Map(connections.map(c => [c.user_id, c]));
    const roleMap = new Map(orgUsers.map(u => [u.user_id, u.role as "member" | "active_member" | "alumni" | "admin"]));
    const prefMap = new Map((preferences || []).map(p => [p.user_id, p]));

    const eligibleUsers: string[] = [];

    for (const userId of connectedUserIds) {
        const connection = connectionMap.get(userId);
        const role = roleMap.get(userId) || null;
        const prefs = prefMap.get(userId) || null;

        if (!role) continue;

        const connectionForSync = connection
            ? { status: connection.status as "connected" | "disconnected" | "reconnect_required" | "error" }
            : null;

        if (isUserEligibleForOutlookSync(event, userId, connectionForSync, prefs, role)) {
            eligibleUsers.push(userId);
        }
    }

    return eligibleUsers;
}

/**
 * Syncs an organization event to all eligible users' Outlook calendars
 */
export async function syncOutlookEventToUsers(
    supabase: SupabaseClient<Database>,
    organizationId: string,
    eventId: string,
    operation: SyncOperation
): Promise<void> {
    const [eventResult, orgResult] = await Promise.all([
        supabase
            .from("events")
            .select("*")
            .eq("id", eventId)
            .single(),
        supabase
            .from("organizations")
            .select("timezone")
            .eq("id", organizationId)
            .single(),
    ]);

    const { data: event, error: eventError } = eventResult;

    if (eventError || !event) {
        console.error("[microsoft-calendar-sync] Failed to fetch event:", eventError);
        return;
    }

    const orgTimeZone = orgResult.data?.timezone || "America/New_York";

    if (operation === "delete") {
        await handleOutlookDeleteSync(supabase, eventId);
        return;
    }

    const eligibleUserIds = await getEligibleUsersForOutlookSync(supabase, organizationId, {
        audience: event.audience,
        target_user_ids: event.target_user_ids,
        event_type: event.event_type as EventType | null,
    });

    if (eligibleUserIds.length === 0) {
        return;
    }

    const calendarEvent = mapEventToMicrosoftCalendarEvent({
        title: event.title,
        description: event.description,
        location: event.location,
        start_date: event.start_date,
        end_date: event.end_date,
    }, orgTimeZone);

    const results = await runWithConcurrencyLimit(
        eligibleUserIds,
        DEFAULT_OUTLOOK_SYNC_CONCURRENCY,
        async (userId) => {
            await syncOutlookEventForUser(supabase, userId, eventId, organizationId, calendarEvent, operation);
        }
    );

    const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    if (firstFailure) {
        throw firstFailure.reason;
    }
}

/**
 * Syncs an event for a single user's Outlook calendar
 */
async function syncOutlookEventForUser(
    supabase: SupabaseClient<Database>,
    userId: string,
    eventId: string,
    organizationId: string,
    calendarEvent: MicrosoftCalendarEvent,
    operation: SyncOperation
): Promise<void> {
    const accessToken = await getMicrosoftValidAccessToken(supabase, userId);
    if (!accessToken) {
        return;
    }

    const connection = await getMicrosoftConnection(supabase, userId);
    // Use the target calendar if set; otherwise defaults to user's calendar (handled in createOutlookCalendarEvent)
    const targetCalendarId = normalizeOutlookTargetCalendarId(connection?.targetCalendarId);
    const storedCalendarId = getStoredOutlookCalendarId(connection?.targetCalendarId);

    const { data: existingEntry } = await supabase
        .from("event_calendar_entries")
        .select("*")
        .eq("event_id", eventId)
        .eq("user_id", userId)
        .eq("provider", "outlook")
        .single();

    if (operation === "create") {
        if (existingEntry && existingEntry.sync_status === "synced") {
            return;
        }

        const result = await createOutlookCalendarEvent(accessToken, calendarEvent, targetCalendarId);
        await updateOutlookSyncEntry(supabase, eventId, userId, organizationId, storedCalendarId, result);
    } else if (operation === "update") {
        if (!existingEntry) {
            const result = await createOutlookCalendarEvent(accessToken, calendarEvent, targetCalendarId);
            await updateOutlookSyncEntry(supabase, eventId, userId, organizationId, storedCalendarId, result);
        } else {
            const normalizedStoredCalendarId = normalizeOutlookTargetCalendarId(existingEntry.external_calendar_id);

            if (normalizedStoredCalendarId !== targetCalendarId) {
                // Calendar changed — migrate the event
                await deleteOutlookCalendarEvent(accessToken, existingEntry.external_event_id);
                const createResult = await createOutlookCalendarEvent(accessToken, calendarEvent, targetCalendarId);
                await updateOutlookSyncEntry(supabase, eventId, userId, organizationId, storedCalendarId, createResult);
            } else {
                const result = await updateOutlookCalendarEvent(accessToken, existingEntry.external_event_id, calendarEvent);

                if (!result.success && isNotFoundError(result.error)) {
                    // Event was deleted from Outlook by user — create new
                    const createResult = await createOutlookCalendarEvent(accessToken, calendarEvent, targetCalendarId);
                    await updateOutlookSyncEntry(supabase, eventId, userId, organizationId, storedCalendarId, createResult);
                } else {
                    await updateOutlookSyncEntry(
                        supabase,
                        eventId,
                        userId,
                        organizationId,
                        storedCalendarId,
                        result,
                        existingEntry.external_event_id
                    );
                }
            }
        }
    }
}

/**
 * Handles delete sync for all users with Outlook entries for this event
 */
async function handleOutlookDeleteSync(
    supabase: SupabaseClient<Database>,
    eventId: string
): Promise<void> {
    const { data: entries, error } = await supabase
        .from("event_calendar_entries")
        .select("*")
        .eq("event_id", eventId)
        .eq("provider", "outlook")
        .neq("sync_status", "deleted");

    if (error || !entries || entries.length === 0) {
        return;
    }

    for (const entry of entries) {
        try {
            const accessToken = await getMicrosoftValidAccessToken(supabase, entry.user_id);
            if (!accessToken) {
                continue;
            }

            const result = await deleteOutlookCalendarEvent(accessToken, entry.external_event_id);

            await supabase
                .from("event_calendar_entries")
                .update({
                    sync_status: result.success ? "deleted" : "failed",
                    last_error: result.error || null,
                })
                .eq("id", entry.id);
        } catch {
            // Graceful handling — continue to next entry
        }
    }
}

/**
 * Updates or creates a sync entry in the database for Outlook
 */
async function updateOutlookSyncEntry(
    supabase: SupabaseClient<Database>,
    eventId: string,
    userId: string,
    organizationId: string,
    externalCalendarId: string,
    result: MicrosoftSyncResult,
    existingExternalEventId?: string
): Promise<void> {
    const externalEventId = result.externalEventId || existingExternalEventId || "";

    if (!externalEventId && !result.success) {
        return;
    }

    await supabase
        .from("event_calendar_entries")
        .upsert({
            event_id: eventId,
            user_id: userId,
            organization_id: organizationId,
            provider: "outlook",
            external_event_id: externalEventId,
            external_calendar_id: externalCalendarId,
            sync_status: result.success ? "synced" : "failed",
            last_error: result.error || null,
        } as Database["public"]["Tables"]["event_calendar_entries"]["Insert"], {
            onConflict: "event_id,user_id,provider",
        });
}
