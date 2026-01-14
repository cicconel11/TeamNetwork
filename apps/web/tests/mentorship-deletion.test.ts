import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { randomUUID } from "crypto";

/**
 * Property 5: Mentorship Pair Deletion Cascade
 * Validates: Requirements 3.3
 *
 * For any mentorship pair, after successful deletion, querying for that pair
 * by ID should return null, and querying for logs with that pair_id should
 * return an empty array.
 */

// In-memory store for testing cascade deletion logic
interface MentorshipPair {
    id: string;
    organization_id: string;
    mentor_user_id: string;
    mentee_user_id: string;
    status: string;
}

interface MentorshipLog {
    id: string;
    pair_id: string;
    organization_id: string;
    notes: string | null;
    entry_date: string;
    created_by: string;
}

interface MentorshipStore {
    pairs: MentorshipPair[];
    logs: MentorshipLog[];
}

// Simulates the deletion cascade logic from MentorshipPairCard
function deleteMentorshipPairWithCascade(
    store: MentorshipStore,
    pairId: string
): { success: boolean; error?: string } {
    // First, delete all logs associated with the pair (cascade)
    const logsToDelete = store.logs.filter((log) => log.pair_id === pairId);
    store.logs = store.logs.filter((log) => log.pair_id !== pairId);

    // Then, delete the pair itself
    const pairIndex = store.pairs.findIndex((p) => p.id === pairId);
    if (pairIndex === -1) {
        return { success: false, error: "Pair not found" };
    }

    store.pairs.splice(pairIndex, 1);
    return { success: true };
}

// Query functions to verify deletion
function getPairById(store: MentorshipStore, pairId: string): MentorshipPair | null {
    return store.pairs.find((p) => p.id === pairId) || null;
}

function getLogsByPairId(store: MentorshipStore, pairId: string): MentorshipLog[] {
    return store.logs.filter((log) => log.pair_id === pairId);
}

// Arbitraries for generating test data
const mentorshipPairArb = fc.record({
    id: fc.uuid(),
    organization_id: fc.uuid(),
    mentor_user_id: fc.uuid(),
    mentee_user_id: fc.uuid(),
    status: fc.constantFrom("active", "paused", "completed"),
});

const mentorshipLogArb = (pairId: string, orgId: string) =>
    fc.record({
        id: fc.uuid(),
        pair_id: fc.constant(pairId),
        organization_id: fc.constant(orgId),
        notes: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
        entry_date: fc.constant(new Date().toISOString()),
        created_by: fc.uuid(),
    });

test("Property 5: Mentorship Pair Deletion Cascade", async (t) => {
    await t.test("deleting a pair removes the pair and all associated logs", () => {
        fc.assert(
            fc.property(
                mentorshipPairArb,
                fc.integer({ min: 0, max: 10 }),
                (pair, logCount) => {
                    // Create a store with the pair
                    const store: MentorshipStore = {
                        pairs: [pair],
                        logs: [],
                    };

                    // Generate logs for this pair
                    const logs = fc.sample(mentorshipLogArb(pair.id, pair.organization_id), logCount);
                    store.logs = logs;

                    // Verify initial state
                    assert.strictEqual(getPairById(store, pair.id)?.id, pair.id, "Pair should exist before deletion");
                    assert.strictEqual(getLogsByPairId(store, pair.id).length, logCount, "Logs should exist before deletion");

                    // Delete the pair with cascade
                    const result = deleteMentorshipPairWithCascade(store, pair.id);

                    // Verify deletion was successful
                    assert.strictEqual(result.success, true, "Deletion should succeed");

                    // Property: After deletion, querying for the pair should return null
                    assert.strictEqual(getPairById(store, pair.id), null, "Pair should not exist after deletion");

                    // Property: After deletion, querying for logs should return empty array
                    assert.deepStrictEqual(getLogsByPairId(store, pair.id), [], "Logs should be empty after deletion");
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("deleting a pair does not affect other pairs or their logs", () => {
        fc.assert(
            fc.property(
                mentorshipPairArb,
                mentorshipPairArb,
                fc.integer({ min: 1, max: 5 }),
                fc.integer({ min: 1, max: 5 }),
                (pair1, pair2, logCount1, logCount2) => {
                    // Ensure pairs have different IDs
                    if (pair1.id === pair2.id) {
                        pair2 = { ...pair2, id: randomUUID() };
                    }

                    // Create a store with both pairs
                    const store: MentorshipStore = {
                        pairs: [pair1, pair2],
                        logs: [],
                    };

                    // Generate logs for both pairs
                    const logs1 = fc.sample(mentorshipLogArb(pair1.id, pair1.organization_id), logCount1);
                    const logs2 = fc.sample(mentorshipLogArb(pair2.id, pair2.organization_id), logCount2);
                    store.logs = [...logs1, ...logs2];

                    // Delete only pair1
                    const result = deleteMentorshipPairWithCascade(store, pair1.id);

                    // Verify deletion was successful
                    assert.strictEqual(result.success, true, "Deletion should succeed");

                    // Property: pair1 should be deleted
                    assert.strictEqual(getPairById(store, pair1.id), null, "Deleted pair should not exist");
                    assert.deepStrictEqual(getLogsByPairId(store, pair1.id), [], "Deleted pair's logs should be empty");

                    // Property: pair2 should still exist with all its logs
                    assert.strictEqual(getPairById(store, pair2.id)?.id, pair2.id, "Other pair should still exist");
                    assert.strictEqual(
                        getLogsByPairId(store, pair2.id).length,
                        logCount2,
                        "Other pair's logs should be unchanged"
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("deleting a non-existent pair returns error", () => {
        fc.assert(
            fc.property(fc.uuid(), (nonExistentId) => {
                const store: MentorshipStore = {
                    pairs: [],
                    logs: [],
                };

                const result = deleteMentorshipPairWithCascade(store, nonExistentId);

                assert.strictEqual(result.success, false, "Deletion of non-existent pair should fail");
                assert.ok(result.error, "Error message should be provided");
            }),
            { numRuns: 100 }
        );
    });
});

/**
 * Property 6: Mentorship Deletion Authorization
 * Validates: Requirements 3.6
 *
 * For any user attempting to delete a mentorship pair, the operation should
 * succeed if and only if the user has the "admin" role for that organization.
 */

type UserRole = "admin" | "active_member" | "alumni" | "viewer";

interface AuthContext {
    userId: string;
    organizationId: string;
    role: UserRole;
    isAdmin: boolean;
}

// Simulates authorization check for deletion
function canDeleteMentorshipPair(authContext: AuthContext, pair: MentorshipPair): boolean {
    // Only admins can delete mentorship pairs
    return authContext.isAdmin && authContext.organizationId === pair.organization_id;
}

// Simulates the full deletion flow with authorization
function attemptDeleteMentorshipPair(
    store: MentorshipStore,
    authContext: AuthContext,
    pairId: string
): { success: boolean; error?: string } {
    const pair = getPairById(store, pairId);
    if (!pair) {
        return { success: false, error: "Mentorship pair not found" };
    }

    if (!canDeleteMentorshipPair(authContext, pair)) {
        return { success: false, error: "Only admins can delete mentorship pairs" };
    }

    return deleteMentorshipPairWithCascade(store, pairId);
}

const authContextArb = (orgId: string) =>
    fc.record({
        userId: fc.uuid(),
        organizationId: fc.constant(orgId),
        role: fc.constantFrom<UserRole>("admin", "active_member", "alumni", "viewer"),
        isAdmin: fc.boolean(),
    }).map((ctx) => ({
        ...ctx,
        // Ensure isAdmin is consistent with role
        isAdmin: ctx.role === "admin",
    }));

test("Property 6: Mentorship Deletion Authorization", async (t) => {
    await t.test("only admin users can delete mentorship pairs", () => {
        fc.assert(
            fc.property(
                mentorshipPairArb,
                fc.constantFrom<UserRole>("admin", "active_member", "alumni", "viewer"),
                (pair, role) => {
                    const store: MentorshipStore = {
                        pairs: [pair],
                        logs: [],
                    };

                    const authContext: AuthContext = {
                        userId: randomUUID(),
                        organizationId: pair.organization_id,
                        role,
                        isAdmin: role === "admin",
                    };

                    const result = attemptDeleteMentorshipPair(store, authContext, pair.id);

                    if (role === "admin") {
                        // Property: Admin should be able to delete
                        assert.strictEqual(result.success, true, "Admin should be able to delete");
                        assert.strictEqual(getPairById(store, pair.id), null, "Pair should be deleted by admin");
                    } else {
                        // Property: Non-admin should not be able to delete
                        assert.strictEqual(result.success, false, `${role} should not be able to delete`);
                        assert.strictEqual(result.error, "Only admins can delete mentorship pairs", "Should return authorization error");
                        assert.ok(getPairById(store, pair.id), "Pair should still exist after failed deletion");
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("admin cannot delete pairs from other organizations", () => {
        fc.assert(
            fc.property(mentorshipPairArb, fc.uuid(), (pair, differentOrgId) => {
                // Ensure the org IDs are different
                if (pair.organization_id === differentOrgId) {
                    return; // Skip this case
                }

                const store: MentorshipStore = {
                    pairs: [pair],
                    logs: [],
                };

                const authContext: AuthContext = {
                    userId: randomUUID(),
                    organizationId: differentOrgId, // Different org
                    role: "admin",
                    isAdmin: true,
                };

                const result = attemptDeleteMentorshipPair(store, authContext, pair.id);

                // Property: Admin from different org should not be able to delete
                assert.strictEqual(result.success, false, "Admin from different org should not be able to delete");
                assert.ok(getPairById(store, pair.id), "Pair should still exist");
            }),
            { numRuns: 100 }
        );
    });

    await t.test("authorization check is consistent with isAdmin flag", () => {
        fc.assert(
            fc.property(mentorshipPairArb, fc.boolean(), (pair, isAdmin) => {
                const store: MentorshipStore = {
                    pairs: [pair],
                    logs: [],
                };

                const authContext: AuthContext = {
                    userId: randomUUID(),
                    organizationId: pair.organization_id,
                    role: isAdmin ? "admin" : "active_member",
                    isAdmin,
                };

                const canDelete = canDeleteMentorshipPair(authContext, pair);

                // Property: canDelete should equal isAdmin when in same org
                assert.strictEqual(canDelete, isAdmin, "canDelete should match isAdmin status");
            }),
            { numRuns: 100 }
        );
    });
});
