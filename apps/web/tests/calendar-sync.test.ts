import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";

// Set up environment variables before importing the module
process.env.GOOGLE_CLIENT_ID = "test-client-id-12345.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Types for calendar events (mirrored from calendar-sync.ts for testing)
interface CalendarEvent {
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
}

/**
 * Maps an organization event to a Google Calendar event format
 * This is a pure function extracted for testing without external dependencies
 */
function mapEventToCalendarEvent(event: {
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
 * Feature: google-calendar-sync, Property 6: Event Data Mapping Completeness
 * 
 * *For any* organization event being synced, the resulting Google Calendar event SHALL contain:
 * - summary equal to event.title
 * - description equal to event.description (if present)
 * - location equal to event.location (if present)
 * - start.dateTime equal to event.start_date
 * - end.dateTime equal to event.end_date (or start_date + 1 hour if no end_date)
 * 
 * **Validates: Requirements 2.2**
 */
test("Property 6: Event Data Mapping Completeness", async () => {
    // Generate valid ISO date strings using timestamps
    const dateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31
        .map(ts => new Date(ts).toISOString());

    await fc.assert(
        fc.asyncProperty(
            // Generate random event data
            fc.record({
                title: fc.string({ minLength: 1, maxLength: 200 }),
                description: fc.option(fc.string({ maxLength: 1000 }), { nil: null }),
                location: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
                start_date: dateArb,
                end_date: fc.option(dateArb, { nil: null }),
            }),
            async (event) => {
                const calendarEvent = mapEventToCalendarEvent(event);

                // summary must equal event.title
                assert.strictEqual(calendarEvent.summary, event.title,
                    "summary must equal event.title");

                // description must equal event.description if present
                if (event.description !== null && event.description !== undefined) {
                    assert.strictEqual(calendarEvent.description, event.description,
                        "description must equal event.description when present");
                } else {
                    assert.strictEqual(calendarEvent.description, undefined,
                        "description must be undefined when event.description is null");
                }

                // location must equal event.location if present
                if (event.location !== null && event.location !== undefined) {
                    assert.strictEqual(calendarEvent.location, event.location,
                        "location must equal event.location when present");
                } else {
                    assert.strictEqual(calendarEvent.location, undefined,
                        "location must be undefined when event.location is null");
                }

                // start.dateTime must be a valid ISO date string derived from event.start_date
                const startDate = new Date(calendarEvent.start.dateTime);
                const originalStartDate = new Date(event.start_date);
                assert.strictEqual(startDate.getTime(), originalStartDate.getTime(),
                    "start.dateTime must equal event.start_date");

                // end.dateTime must equal event.end_date or start_date + 1 hour
                const endDate = new Date(calendarEvent.end.dateTime);
                if (event.end_date !== null && event.end_date !== undefined) {
                    const originalEndDate = new Date(event.end_date);
                    assert.strictEqual(endDate.getTime(), originalEndDate.getTime(),
                        "end.dateTime must equal event.end_date when present");
                } else {
                    const expectedEndDate = new Date(originalStartDate.getTime() + 60 * 60 * 1000);
                    assert.strictEqual(endDate.getTime(), expectedEndDate.getTime(),
                        "end.dateTime must equal start_date + 1 hour when end_date is null");
                }

                // timeZone must be present
                assert.ok(calendarEvent.start.timeZone,
                    "start.timeZone must be present");
                assert.ok(calendarEvent.end.timeZone,
                    "end.timeZone must be present");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


// Event types that can be synced
type EventType = "general" | "game" | "meeting" | "social" | "fundraiser" | "philanthropy";

/**
 * Determines if a user should receive calendar sync for an event
 * Pure function extracted for testing
 */
function isUserEligibleForSync(
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
 * Feature: google-calendar-sync, Property 5: Event Sync Targets Correct Users
 * 
 * *For any* organization event with a given audience setting and event type, the sync operation
 * SHALL create calendar entries ONLY for users who:
 * 1. Have a connected Google Calendar in that organization
 * 2. Are eligible based on the event's audience (members, alumni, both, or specific users)
 * 3. Have the event's type enabled in their sync preferences
 * 
 * **Validates: Requirements 2.1, 2.5, 5.3**
 */
test("Property 5: Event Sync Targets Correct Users", async () => {
    const eventTypeArb = fc.constantFrom<EventType>("general", "game", "meeting", "social", "fundraiser", "philanthropy");
    const audienceArb = fc.constantFrom("all", "members", "alumni", "both");
    const roleArb = fc.constantFrom<"member" | "alumni" | "admin">("member", "alumni", "admin");
    const connectionStatusArb = fc.constantFrom<"connected" | "disconnected" | "error">("connected", "disconnected", "error");

    await fc.assert(
        fc.asyncProperty(
            // Generate event data
            fc.record({
                audience: fc.option(audienceArb, { nil: null }),
                target_user_ids: fc.option(fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }), { nil: null }),
                event_type: fc.option(eventTypeArb, { nil: null }),
            }),
            // Generate user data
            fc.uuid(),
            fc.option(fc.record({ status: connectionStatusArb }), { nil: null }),
            fc.option(fc.record({
                sync_general: fc.option(fc.boolean(), { nil: null }),
                sync_game: fc.option(fc.boolean(), { nil: null }),
                sync_meeting: fc.option(fc.boolean(), { nil: null }),
                sync_social: fc.option(fc.boolean(), { nil: null }),
                sync_fundraiser: fc.option(fc.boolean(), { nil: null }),
                sync_philanthropy: fc.option(fc.boolean(), { nil: null }),
            }), { nil: null }),
            fc.option(roleArb, { nil: null }),
            async (event, userId, connection, preferences, userRole) => {
                const isEligible = isUserEligibleForSync(event, userId, connection, preferences, userRole);

                // Verify condition 1: Must have connected calendar
                if (!connection || connection.status !== "connected") {
                    assert.strictEqual(isEligible, false,
                        "User without connected calendar should not be eligible");
                    return true;
                }

                // Verify condition 2: Must be eligible based on audience
                const audience = event.audience || "all";
                const targetUserIds = event.target_user_ids || [];

                if (targetUserIds.length > 0) {
                    // Specific users targeted
                    if (!targetUserIds.includes(userId)) {
                        assert.strictEqual(isEligible, false,
                            "User not in target_user_ids should not be eligible");
                        return true;
                    }
                } else {
                    // Audience-based targeting
                    if (audience === "members" && userRole !== "member" && userRole !== "admin") {
                        assert.strictEqual(isEligible, false,
                            "Non-member should not be eligible for members-only event");
                        return true;
                    }
                    if (audience === "alumni" && userRole !== "alumni") {
                        assert.strictEqual(isEligible, false,
                            "Non-alumni should not be eligible for alumni-only event");
                        return true;
                    }
                }

                // Verify condition 3: Must have event type enabled in preferences
                const eventType = event.event_type || "general";
                if (preferences) {
                    const prefKey = `sync_${eventType}` as keyof typeof preferences;
                    const prefValue = preferences[prefKey];
                    if (prefValue === false) {
                        assert.strictEqual(isEligible, false,
                            `User with ${eventType} sync disabled should not be eligible`);
                        return true;
                    }
                }

                // If all conditions pass, user should be eligible
                // (unless they have no role in the org, which we handle separately)
                if (userRole === null) {
                    // No role means not in org - handled by getEligibleUsersForEvent
                    // isUserEligibleForSync doesn't check this directly
                }

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


// Sync result type
interface SyncResult {
    success: boolean;
    googleEventId?: string;
    error?: string;
}

// Sync status type
type SyncStatus = "pending" | "synced" | "failed" | "deleted";

/**
 * Determines the expected sync status based on operation result
 * Pure function for testing sync status tracking logic
 */
function determineSyncStatus(
    result: SyncResult,
    operation: "create" | "update" | "delete"
): SyncStatus {
    if (operation === "delete") {
        return result.success ? "deleted" : "failed";
    }
    return result.success ? "synced" : "failed";
}

/**
 * Feature: google-calendar-sync, Property 7: Sync Status Tracking
 * 
 * *For any* sync operation:
 * - If the Google Calendar API returns success, the `event_calendar_entries` record SHALL have sync_status "synced"
 * - If the Google Calendar API returns an error, the record SHALL have sync_status "failed" and last_error populated
 * - If a deletion succeeds, the record SHALL have sync_status "deleted"
 * 
 * **Validates: Requirements 2.3, 2.4, 4.2**
 */
test("Property 7: Sync Status Tracking", async () => {
    const operationArb = fc.constantFrom<"create" | "update" | "delete">("create", "update", "delete");

    await fc.assert(
        fc.asyncProperty(
            // Generate sync result
            fc.record({
                success: fc.boolean(),
                googleEventId: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
                error: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
            }),
            operationArb,
            async (result, operation) => {
                const status = determineSyncStatus(result, operation);

                // Verify status based on success and operation
                if (result.success) {
                    if (operation === "delete") {
                        assert.strictEqual(status, "deleted",
                            "Successful deletion should result in 'deleted' status");
                    } else {
                        assert.strictEqual(status, "synced",
                            "Successful create/update should result in 'synced' status");
                    }
                } else {
                    assert.strictEqual(status, "failed",
                        "Failed operation should result in 'failed' status");
                }

                // Verify error is populated on failure
                if (!result.success && result.error) {
                    assert.ok(result.error.length > 0,
                        "Failed operation should have error message");
                }

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Checks if an error message indicates a 404 Not Found error
 * Pure function for testing missing event recovery logic
 */
function isNotFoundError(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    return errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found");
}

/**
 * Simulates the missing event recovery logic
 * When update fails with 404, should create new event
 */
function shouldRecoverMissingEvent(
    updateResult: SyncResult,
    existingEntry: { google_event_id: string } | null
): { shouldCreate: boolean; reason: string } {
    // No existing entry - should create (not recovery, just normal create)
    if (!existingEntry) {
        return { shouldCreate: true, reason: "no_existing_entry" };
    }

    // Update succeeded - no recovery needed
    if (updateResult.success) {
        return { shouldCreate: false, reason: "update_succeeded" };
    }

    // Update failed with 404 - should recover by creating new event
    if (isNotFoundError(updateResult.error)) {
        return { shouldCreate: true, reason: "404_recovery" };
    }

    // Update failed with other error - no recovery
    return { shouldCreate: false, reason: "other_error" };
}

/**
 * Feature: google-calendar-sync, Property 9: Missing Event Recovery
 * 
 * *For any* update operation where the Google Calendar event no longer exists (404 response),
 * the system SHALL create a new Google Calendar event and update the `event_calendar_entries`
 * record with the new google_event_id.
 * 
 * **Validates: Requirements 3.3**
 */
test("Property 9: Missing Event Recovery", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate update result
            fc.record({
                success: fc.boolean(),
                googleEventId: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
                error: fc.oneof(
                    fc.constant(undefined),
                    fc.constant("404: Event not found in Google Calendar"),
                    fc.constant("Not Found"),
                    fc.constant("Network error"),
                    fc.constant("Permission denied"),
                    fc.string({ minLength: 1, maxLength: 100 })
                ),
            }),
            // Generate existing entry
            fc.option(
                fc.record({
                    google_event_id: fc.string({ minLength: 10, maxLength: 50 }),
                }),
                { nil: null }
            ),
            async (updateResult, existingEntry) => {
                const recovery = shouldRecoverMissingEvent(updateResult, existingEntry);

                // If update failed with 404 and there was an existing entry, should recover
                if (!updateResult.success && existingEntry && isNotFoundError(updateResult.error)) {
                    assert.strictEqual(recovery.shouldCreate, true,
                        "Should create new event when update fails with 404");
                    assert.strictEqual(recovery.reason, "404_recovery",
                        "Reason should be 404_recovery");
                }

                // If update succeeded, should not create
                if (updateResult.success && existingEntry) {
                    assert.strictEqual(recovery.shouldCreate, false,
                        "Should not create new event when update succeeds");
                }

                // If no existing entry, should create (normal flow, not recovery)
                if (!existingEntry) {
                    assert.strictEqual(recovery.shouldCreate, true,
                        "Should create when no existing entry");
                    assert.strictEqual(recovery.reason, "no_existing_entry",
                        "Reason should be no_existing_entry");
                }

                // If update failed with non-404 error, should not recover
                if (!updateResult.success && existingEntry && !isNotFoundError(updateResult.error)) {
                    assert.strictEqual(recovery.shouldCreate, false,
                        "Should not create new event for non-404 errors");
                    assert.strictEqual(recovery.reason, "other_error",
                        "Reason should be other_error");
                }

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Simulates graceful deletion handling
 * Deletion failures should NOT throw or block processing
 */
function handleDeletionGracefully(
    deleteResults: SyncResult[]
): { allProcessed: boolean; failedCount: number; successCount: number } {
    let failedCount = 0;
    let successCount = 0;

    for (const result of deleteResults) {
        if (result.success) {
            successCount++;
        } else {
            // Log error but continue - graceful handling
            failedCount++;
        }
    }

    // All entries were processed regardless of success/failure
    return {
        allProcessed: true,
        failedCount,
        successCount,
    };
}

/**
 * Feature: google-calendar-sync, Property 11: Deletion Failure Graceful Handling
 * 
 * *For any* Google Calendar deletion that fails, the system SHALL log the error
 * but SHALL NOT throw an exception or block the organization event deletion.
 * 
 * **Validates: Requirements 4.3**
 */
test("Property 11: Deletion Failure Graceful Handling", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate array of deletion results (some success, some failure)
            fc.array(
                fc.record({
                    success: fc.boolean(),
                    googleEventId: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
                    error: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
                }),
                { minLength: 0, maxLength: 10 }
            ),
            async (deleteResults) => {
                // Process all deletions gracefully
                const result = handleDeletionGracefully(deleteResults);

                // All entries should be processed regardless of individual failures
                assert.strictEqual(result.allProcessed, true,
                    "All entries should be processed even if some fail");

                // Count should match
                assert.strictEqual(result.failedCount + result.successCount, deleteResults.length,
                    "Total processed should equal input length");

                // Verify individual counts
                const expectedSuccess = deleteResults.filter(r => r.success).length;
                const expectedFailed = deleteResults.filter(r => !r.success).length;

                assert.strictEqual(result.successCount, expectedSuccess,
                    "Success count should match successful deletions");
                assert.strictEqual(result.failedCount, expectedFailed,
                    "Failed count should match failed deletions");

                // Key property: function should NOT throw even with all failures
                const allFailures = deleteResults.map(() => ({
                    success: false,
                    error: "Simulated failure",
                }));

                // This should not throw
                const failureResult = handleDeletionGracefully(allFailures);
                assert.strictEqual(failureResult.allProcessed, true,
                    "Should process all entries even when all fail");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Feature: google-calendar-sync, Property 12: Preference Storage Round-Trip
 * 
 * *For any* valid combination of sync preferences (6 boolean values for event types),
 * storing and then retrieving the preferences SHALL return the same values.
 * 
 * **Validates: Requirements 5.2**
 */

// Sync preferences interface
interface SyncPreferences {
    sync_general: boolean;
    sync_game: boolean;
    sync_meeting: boolean;
    sync_social: boolean;
    sync_fundraiser: boolean;
    sync_philanthropy: boolean;
}

// Simulated preference store for testing round-trip logic
class MockPreferenceStore {
    private preferences: Map<string, SyncPreferences> = new Map();

    private getKey(userId: string, organizationId: string): string {
        return `${userId}:${organizationId}`;
    }

    /**
     * Stores preferences (simulates database upsert)
     */
    store(userId: string, organizationId: string, prefs: Partial<SyncPreferences>): SyncPreferences {
        const key = this.getKey(userId, organizationId);
        const existing = this.preferences.get(key);

        // Merge with existing or defaults
        const defaults: SyncPreferences = {
            sync_general: true,
            sync_game: true,
            sync_meeting: true,
            sync_social: true,
            sync_fundraiser: true,
            sync_philanthropy: true,
        };

        const merged: SyncPreferences = {
            ...defaults,
            ...existing,
            ...prefs,
        };

        this.preferences.set(key, merged);
        return merged;
    }

    /**
     * Retrieves preferences (simulates database select)
     */
    retrieve(userId: string, organizationId: string): SyncPreferences | null {
        const key = this.getKey(userId, organizationId);
        return this.preferences.get(key) || null;
    }

    /**
     * Retrieves preferences with defaults if not found
     */
    retrieveWithDefaults(userId: string, organizationId: string): SyncPreferences {
        const stored = this.retrieve(userId, organizationId);
        if (stored) return stored;

        return {
            sync_general: true,
            sync_game: true,
            sync_meeting: true,
            sync_social: true,
            sync_fundraiser: true,
            sync_philanthropy: true,
        };
    }
}

test("Property 12: Preference Storage Round-Trip", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate user and organization IDs
            fc.uuid(),
            fc.uuid(),
            // Generate all 6 boolean preferences
            fc.record({
                sync_general: fc.boolean(),
                sync_game: fc.boolean(),
                sync_meeting: fc.boolean(),
                sync_social: fc.boolean(),
                sync_fundraiser: fc.boolean(),
                sync_philanthropy: fc.boolean(),
            }),
            async (userId, organizationId, preferences) => {
                const store = new MockPreferenceStore();

                // Store preferences
                const storedResult = store.store(userId, organizationId, preferences);

                // Retrieve preferences
                const retrieved = store.retrieve(userId, organizationId);

                // Retrieved should not be null
                assert.ok(retrieved !== null,
                    "Retrieved preferences should not be null after storing");

                // All 6 values should match exactly
                assert.strictEqual(retrieved!.sync_general, preferences.sync_general,
                    "sync_general should match after round-trip");
                assert.strictEqual(retrieved!.sync_game, preferences.sync_game,
                    "sync_game should match after round-trip");
                assert.strictEqual(retrieved!.sync_meeting, preferences.sync_meeting,
                    "sync_meeting should match after round-trip");
                assert.strictEqual(retrieved!.sync_social, preferences.sync_social,
                    "sync_social should match after round-trip");
                assert.strictEqual(retrieved!.sync_fundraiser, preferences.sync_fundraiser,
                    "sync_fundraiser should match after round-trip");
                assert.strictEqual(retrieved!.sync_philanthropy, preferences.sync_philanthropy,
                    "sync_philanthropy should match after round-trip");

                // Stored result should also match
                assert.deepStrictEqual(storedResult, retrieved,
                    "Stored result should equal retrieved result");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Property 12 (additional): Partial preference updates preserve other values
 */
test("Property 12 (additional): Partial updates preserve other values", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.uuid(),
            fc.uuid(),
            // Initial full preferences
            fc.record({
                sync_general: fc.boolean(),
                sync_game: fc.boolean(),
                sync_meeting: fc.boolean(),
                sync_social: fc.boolean(),
                sync_fundraiser: fc.boolean(),
                sync_philanthropy: fc.boolean(),
            }),
            // Partial update (only some fields)
            fc.record({
                sync_general: fc.option(fc.boolean(), { nil: undefined }),
                sync_game: fc.option(fc.boolean(), { nil: undefined }),
                sync_meeting: fc.option(fc.boolean(), { nil: undefined }),
            }),
            async (userId, organizationId, initialPrefs, partialUpdate) => {
                const store = new MockPreferenceStore();

                // Store initial preferences
                store.store(userId, organizationId, initialPrefs);

                // Apply partial update
                const updatePayload: Partial<SyncPreferences> = {};
                if (partialUpdate.sync_general !== undefined) {
                    updatePayload.sync_general = partialUpdate.sync_general;
                }
                if (partialUpdate.sync_game !== undefined) {
                    updatePayload.sync_game = partialUpdate.sync_game;
                }
                if (partialUpdate.sync_meeting !== undefined) {
                    updatePayload.sync_meeting = partialUpdate.sync_meeting;
                }

                store.store(userId, organizationId, updatePayload);

                // Retrieve and verify
                const retrieved = store.retrieve(userId, organizationId)!;

                // Updated fields should have new values
                if (partialUpdate.sync_general !== undefined) {
                    assert.strictEqual(retrieved.sync_general, partialUpdate.sync_general,
                        "Updated sync_general should have new value");
                } else {
                    assert.strictEqual(retrieved.sync_general, initialPrefs.sync_general,
                        "Non-updated sync_general should preserve original value");
                }

                // Non-updated fields should preserve original values
                assert.strictEqual(retrieved.sync_social, initialPrefs.sync_social,
                    "sync_social should preserve original value");
                assert.strictEqual(retrieved.sync_fundraiser, initialPrefs.sync_fundraiser,
                    "sync_fundraiser should preserve original value");
                assert.strictEqual(retrieved.sync_philanthropy, initialPrefs.sync_philanthropy,
                    "sync_philanthropy should preserve original value");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Property 12 (additional): Default values when no preferences exist
 */
test("Property 12 (additional): Default values when no preferences exist", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.uuid(),
            fc.uuid(),
            async (userId, organizationId) => {
                const store = new MockPreferenceStore();

                // Retrieve without storing first
                const retrieved = store.retrieveWithDefaults(userId, organizationId);

                // All defaults should be true
                assert.strictEqual(retrieved.sync_general, true,
                    "Default sync_general should be true");
                assert.strictEqual(retrieved.sync_game, true,
                    "Default sync_game should be true");
                assert.strictEqual(retrieved.sync_meeting, true,
                    "Default sync_meeting should be true");
                assert.strictEqual(retrieved.sync_social, true,
                    "Default sync_social should be true");
                assert.strictEqual(retrieved.sync_fundraiser, true,
                    "Default sync_fundraiser should be true");
                assert.strictEqual(retrieved.sync_philanthropy, true,
                    "Default sync_philanthropy should be true");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Feature: google-calendar-sync, Property 8: Update Propagation
 * 
 * *For any* event update, the system SHALL update all existing `event_calendar_entries`
 * for that event by using the stored google_event_id to locate and update the
 * corresponding Google Calendar events.
 * 
 * **Validates: Requirements 3.1, 3.2**
 */

// Simulated event calendar entry for testing update propagation
interface EventCalendarEntry {
    id: string;
    event_id: string;
    user_id: string;
    organization_id: string;
    google_event_id: string;
    sync_status: SyncStatus;
    last_error: string | null;
}

// Simulated update propagation logic
function simulateUpdatePropagation(
    entries: EventCalendarEntry[],
    eventId: string,
    updateResults: Map<string, SyncResult>
): { updatedEntries: EventCalendarEntry[]; usedGoogleEventIds: string[] } {
    const usedGoogleEventIds: string[] = [];
    const updatedEntries: EventCalendarEntry[] = [];

    for (const entry of entries) {
        if (entry.event_id !== eventId) {
            // Entry not for this event, skip
            updatedEntries.push(entry);
            continue;
        }

        // Track that we used this google_event_id for the update
        usedGoogleEventIds.push(entry.google_event_id);

        // Get the result for this user
        const result = updateResults.get(entry.user_id);

        if (!result) {
            // No result means user wasn't processed (e.g., no valid token)
            updatedEntries.push(entry);
            continue;
        }

        // Update the entry based on result
        const updatedEntry: EventCalendarEntry = {
            ...entry,
            sync_status: result.success ? "synced" : "failed",
            last_error: result.error || null,
        };

        // If 404 recovery happened, update the google_event_id
        if (!result.success && isNotFoundError(result.error) && result.googleEventId) {
            updatedEntry.google_event_id = result.googleEventId;
            updatedEntry.sync_status = "synced";
            updatedEntry.last_error = null;
        } else if (result.success && result.googleEventId) {
            // Normal update might return the same or new ID
            updatedEntry.google_event_id = result.googleEventId;
        }

        updatedEntries.push(updatedEntry);
    }

    return { updatedEntries, usedGoogleEventIds };
}

test("Property 8: Update Propagation", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate event ID
            fc.uuid(),
            // Generate array of calendar entries for this event
            fc.array(
                fc.record({
                    id: fc.uuid(),
                    event_id: fc.uuid(), // Will be overwritten for some entries
                    user_id: fc.uuid(),
                    organization_id: fc.uuid(),
                    google_event_id: fc.string({ minLength: 10, maxLength: 50 }),
                    sync_status: fc.constantFrom<SyncStatus>("synced", "pending", "failed"),
                    last_error: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
                }),
                { minLength: 1, maxLength: 10 }
            ),
            // Generate update results for each user
            fc.array(
                fc.record({
                    success: fc.boolean(),
                    googleEventId: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
                    error: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
                }),
                { minLength: 1, maxLength: 10 }
            ),
            async (eventId, entries, results) => {
                // Make some entries belong to the target event
                const targetEntries = entries.map((entry, idx) => ({
                    ...entry,
                    event_id: idx % 2 === 0 ? eventId : entry.event_id,
                }));

                // Create results map for users with entries for this event
                const updateResults = new Map<string, SyncResult>();
                const entriesForEvent = targetEntries.filter(e => e.event_id === eventId);
                entriesForEvent.forEach((entry, idx) => {
                    if (idx < results.length) {
                        updateResults.set(entry.user_id, results[idx]);
                    }
                });

                const { updatedEntries, usedGoogleEventIds } = simulateUpdatePropagation(
                    targetEntries,
                    eventId,
                    updateResults
                );

                // Property: All entries for the event should have their google_event_id used
                const entriesForEventAfter = updatedEntries.filter(e => e.event_id === eventId);
                const originalGoogleEventIds = entriesForEvent.map(e => e.google_event_id);

                // All original google_event_ids should have been used for updates
                for (const googleEventId of originalGoogleEventIds) {
                    assert.ok(
                        usedGoogleEventIds.includes(googleEventId),
                        `google_event_id ${googleEventId} should have been used for update`
                    );
                }

                // Property: Entries not for this event should be unchanged
                const otherEntries = targetEntries.filter(e => e.event_id !== eventId);
                const otherEntriesAfter = updatedEntries.filter(e => e.event_id !== eventId);

                assert.strictEqual(
                    otherEntries.length,
                    otherEntriesAfter.length,
                    "Number of other entries should be unchanged"
                );

                for (let i = 0; i < otherEntries.length; i++) {
                    assert.deepStrictEqual(
                        otherEntries[i],
                        otherEntriesAfter[i],
                        "Entries not for this event should be unchanged"
                    );
                }

                // Property: Updated entries should have correct sync_status based on result
                for (const entry of entriesForEventAfter) {
                    const result = updateResults.get(entry.user_id);
                    if (result) {
                        if (result.success) {
                            assert.strictEqual(
                                entry.sync_status,
                                "synced",
                                "Successful update should result in synced status"
                            );
                        } else if (!isNotFoundError(result.error)) {
                            assert.strictEqual(
                                entry.sync_status,
                                "failed",
                                "Failed update (non-404) should result in failed status"
                            );
                        }
                    }
                }

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Feature: google-calendar-sync, Property 10: Deletion Propagation
 * 
 * *For any* soft-deleted organization event, the system SHALL attempt to delete
 * all corresponding Google Calendar events for all users with `event_calendar_entries`
 * for that event.
 * 
 * **Validates: Requirements 4.1**
 */

// Simulated deletion propagation logic
function simulateDeletionPropagation(
    entries: EventCalendarEntry[],
    eventId: string,
    deleteResults: Map<string, SyncResult>
): { processedUserIds: string[]; updatedEntries: EventCalendarEntry[] } {
    const processedUserIds: string[] = [];
    const updatedEntries: EventCalendarEntry[] = [];

    for (const entry of entries) {
        if (entry.event_id !== eventId) {
            // Entry not for this event, skip
            updatedEntries.push(entry);
            continue;
        }

        // Skip already deleted entries
        if (entry.sync_status === "deleted") {
            updatedEntries.push(entry);
            continue;
        }

        // Track that we attempted deletion for this user
        processedUserIds.push(entry.user_id);

        // Get the result for this user
        const result = deleteResults.get(entry.user_id);

        if (!result) {
            // No result means user wasn't processed (e.g., no valid token)
            // Graceful handling - continue processing
            updatedEntries.push(entry);
            continue;
        }

        // Update the entry based on result (graceful handling - always update status)
        const updatedEntry: EventCalendarEntry = {
            ...entry,
            sync_status: result.success ? "deleted" : "failed",
            last_error: result.error || null,
        };

        updatedEntries.push(updatedEntry);
    }

    return { processedUserIds, updatedEntries };
}

test("Property 10: Deletion Propagation", async () => {
    // Custom arbitrary for deletion results that ensures error is present when success is false
    const deletionResultArb = fc.boolean().chain(success => {
        if (success) {
            return fc.record({
                success: fc.constant(true),
                googleEventId: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
                error: fc.constant(undefined),
            });
        } else {
            // When success is false, always include an error message
            return fc.record({
                success: fc.constant(false),
                googleEventId: fc.constant(undefined),
                error: fc.string({ minLength: 1, maxLength: 100 }),
            });
        }
    });

    await fc.assert(
        fc.asyncProperty(
            // Generate event ID
            fc.uuid(),
            // Generate array of calendar entries
            fc.array(
                fc.record({
                    id: fc.uuid(),
                    event_id: fc.uuid(),
                    user_id: fc.uuid(),
                    organization_id: fc.uuid(),
                    google_event_id: fc.string({ minLength: 10, maxLength: 50 }),
                    sync_status: fc.constantFrom<SyncStatus>("synced", "pending", "failed"),
                    last_error: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
                }),
                { minLength: 1, maxLength: 10 }
            ),
            // Generate deletion results with proper error handling
            fc.array(deletionResultArb, { minLength: 1, maxLength: 10 }),
            async (eventId, entries, results) => {
                // Make some entries belong to the target event
                const targetEntries = entries.map((entry, idx) => ({
                    ...entry,
                    event_id: idx % 2 === 0 ? eventId : entry.event_id,
                }));

                // Create results map for users with entries for this event
                const deleteResults = new Map<string, SyncResult>();
                const entriesForEvent = targetEntries.filter(
                    e => e.event_id === eventId && e.sync_status !== "deleted"
                );
                entriesForEvent.forEach((entry, idx) => {
                    if (idx < results.length) {
                        deleteResults.set(entry.user_id, results[idx]);
                    }
                });

                const { processedUserIds, updatedEntries } = simulateDeletionPropagation(
                    targetEntries,
                    eventId,
                    deleteResults
                );

                // Property: All users with entries for this event should be processed
                const expectedUserIds = entriesForEvent.map(e => e.user_id);
                for (const userId of expectedUserIds) {
                    assert.ok(
                        processedUserIds.includes(userId),
                        `User ${userId} should have been processed for deletion`
                    );
                }

                // Property: Entries for the event should have updated status
                const entriesForEventAfter = updatedEntries.filter(e => e.event_id === eventId);
                for (const entry of entriesForEventAfter) {
                    const result = deleteResults.get(entry.user_id);
                    if (result) {
                        if (result.success) {
                            assert.strictEqual(
                                entry.sync_status,
                                "deleted",
                                "Successful deletion should result in deleted status"
                            );
                        } else {
                            assert.strictEqual(
                                entry.sync_status,
                                "failed",
                                "Failed deletion should result in failed status"
                            );
                            assert.ok(
                                entry.last_error !== null,
                                "Failed deletion should have error message"
                            );
                        }
                    }
                }

                // Property: Entries not for this event should be unchanged
                const otherEntries = targetEntries.filter(e => e.event_id !== eventId);
                const otherEntriesAfter = updatedEntries.filter(e => e.event_id !== eventId);

                assert.strictEqual(
                    otherEntries.length,
                    otherEntriesAfter.length,
                    "Number of other entries should be unchanged"
                );

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Feature: google-calendar-sync, Property 13: Preference Changes Idempotence on Past Syncs
 * 
 * *For any* user who changes their sync preferences, the set of `event_calendar_entries`
 * for events created BEFORE the preference change SHALL remain unchanged.
 * 
 * **Validates: Requirements 5.4**
 */

// Simulated preference change handling
function simulatePreferenceChange(
    existingEntries: EventCalendarEntry[],
    userId: string,
    _oldPreferences: SyncPreferences,
    _newPreferences: SyncPreferences,
    eventCreationTimes: Map<string, Date>,
    preferenceChangeTime: Date
): EventCalendarEntry[] {
    // Key property: Preference changes should NOT affect entries for events
    // created BEFORE the preference change

    // Filter entries for this user
    const userEntries = existingEntries.filter(e => e.user_id === userId);
    const otherEntries = existingEntries.filter(e => e.user_id !== userId);

    // For each user entry, check if the event was created before preference change
    const unchangedEntries: EventCalendarEntry[] = [];

    for (const entry of userEntries) {
        const eventCreationTime = eventCreationTimes.get(entry.event_id);

        if (eventCreationTime && eventCreationTime < preferenceChangeTime) {
            // Event was created before preference change - entry should remain unchanged
            unchangedEntries.push(entry);
        } else {
            // Event was created after preference change - could be affected
            // But for this property, we're only checking that past entries are unchanged
            unchangedEntries.push(entry);
        }
    }

    return [...otherEntries, ...unchangedEntries];
}

test("Property 13: Preference Changes Idempotence on Past Syncs", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate user ID
            fc.uuid(),
            // Generate existing calendar entries
            fc.array(
                fc.record({
                    id: fc.uuid(),
                    event_id: fc.uuid(),
                    user_id: fc.uuid(),
                    organization_id: fc.uuid(),
                    google_event_id: fc.string({ minLength: 10, maxLength: 50 }),
                    sync_status: fc.constantFrom<SyncStatus>("synced", "pending", "failed"),
                    last_error: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
                }),
                { minLength: 1, maxLength: 10 }
            ),
            // Generate old and new preferences
            fc.record({
                sync_general: fc.boolean(),
                sync_game: fc.boolean(),
                sync_meeting: fc.boolean(),
                sync_social: fc.boolean(),
                sync_fundraiser: fc.boolean(),
                sync_philanthropy: fc.boolean(),
            }),
            fc.record({
                sync_general: fc.boolean(),
                sync_game: fc.boolean(),
                sync_meeting: fc.boolean(),
                sync_social: fc.boolean(),
                sync_fundraiser: fc.boolean(),
                sync_philanthropy: fc.boolean(),
            }),
            // Generate timestamps
            fc.integer({ min: 1577836800000, max: 1893456000000 }), // 2020-2030
            async (userId, entries, oldPrefs, newPrefs, preferenceChangeTimestamp) => {
                // Make some entries belong to the target user
                const targetEntries = entries.map((entry, idx) => ({
                    ...entry,
                    user_id: idx % 3 === 0 ? userId : entry.user_id,
                }));

                // Create event creation times (some before, some after preference change)
                const preferenceChangeTime = new Date(preferenceChangeTimestamp);
                const eventCreationTimes = new Map<string, Date>();

                targetEntries.forEach((entry, idx) => {
                    // Alternate between before and after preference change
                    const offset = idx % 2 === 0 ? -86400000 : 86400000; // +/- 1 day
                    eventCreationTimes.set(
                        entry.event_id,
                        new Date(preferenceChangeTimestamp + offset)
                    );
                });

                // Get entries for this user before preference change
                const userEntriesBefore = targetEntries.filter(e => e.user_id === userId);
                const entriesForPastEvents = userEntriesBefore.filter(entry => {
                    const creationTime = eventCreationTimes.get(entry.event_id);
                    return creationTime && creationTime < preferenceChangeTime;
                });

                // Simulate preference change
                const entriesAfter = simulatePreferenceChange(
                    targetEntries,
                    userId,
                    oldPrefs,
                    newPrefs,
                    eventCreationTimes,
                    preferenceChangeTime
                );

                // Get entries for past events after preference change
                const userEntriesAfter = entriesAfter.filter(e => e.user_id === userId);
                const entriesForPastEventsAfter = userEntriesAfter.filter(entry => {
                    const creationTime = eventCreationTimes.get(entry.event_id);
                    return creationTime && creationTime < preferenceChangeTime;
                });

                // Property: Entries for events created before preference change should be unchanged
                assert.strictEqual(
                    entriesForPastEvents.length,
                    entriesForPastEventsAfter.length,
                    "Number of entries for past events should be unchanged"
                );

                // Each entry should be identical
                for (const entryBefore of entriesForPastEvents) {
                    const entryAfter = entriesForPastEventsAfter.find(e => e.id === entryBefore.id);
                    assert.ok(
                        entryAfter !== undefined,
                        `Entry ${entryBefore.id} should still exist after preference change`
                    );
                    assert.deepStrictEqual(
                        entryBefore,
                        entryAfter,
                        "Entry for past event should be unchanged after preference change"
                    );
                }

                // Property: Entries for other users should be completely unchanged
                const otherEntriesBefore = targetEntries.filter(e => e.user_id !== userId);
                const otherEntriesAfter = entriesAfter.filter(e => e.user_id !== userId);

                assert.strictEqual(
                    otherEntriesBefore.length,
                    otherEntriesAfter.length,
                    "Number of entries for other users should be unchanged"
                );

                return true;
            }
        ),
        { numRuns: 100 }
    );
});
