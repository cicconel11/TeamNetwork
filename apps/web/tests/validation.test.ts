/**
 * Consolidated Validation Tests
 *
 * Tests for input validation and business logic including:
 * - Organization name validation
 * - Mentorship pair deletion (cascade and authorization)
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { randomUUID } from "crypto";
import { validateOrgName } from "../src/lib/validation/org-name.ts";

// Mentorship types for testing
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

type UserRole = "admin" | "active_member" | "alumni" | "viewer";

interface AuthContext {
  userId: string;
  organizationId: string;
  role: UserRole;
  isAdmin: boolean;
}

// Mentorship deletion functions
function deleteMentorshipPairWithCascade(store: MentorshipStore, pairId: string): { success: boolean; error?: string } {
  // First, delete all logs associated with the pair (cascade)
  store.logs = store.logs.filter((log) => log.pair_id !== pairId);

  // Then, delete the pair itself
  const pairIndex = store.pairs.findIndex((p) => p.id === pairId);
  if (pairIndex === -1) {
    return { success: false, error: "Pair not found" };
  }

  store.pairs.splice(pairIndex, 1);
  return { success: true };
}

function getPairById(store: MentorshipStore, pairId: string): MentorshipPair | null {
  return store.pairs.find((p) => p.id === pairId) || null;
}

function getLogsByPairId(store: MentorshipStore, pairId: string): MentorshipLog[] {
  return store.logs.filter((log) => log.pair_id === pairId);
}

function canDeleteMentorshipPair(authContext: AuthContext, pair: MentorshipPair): boolean {
  // Only admins can delete mentorship pairs
  return authContext.isAdmin && authContext.organizationId === pair.organization_id;
}

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

describe("Validation", () => {
  describe("Organization Name Validation", () => {
    it("should accept valid names (non-empty strings with length <= 100 after trim)", () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 100 })
            .filter((s) => s.trim().length > 0 && s.trim().length <= 100),
          (name) => {
            const result = validateOrgName(name);
            assert.strictEqual(result.valid, true, `Name "${name}" should be valid`);
            assert.strictEqual(result.error, undefined, `Valid name should have no error`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should reject empty strings or whitespace-only strings", () => {
      // Test empty string
      const emptyResult = validateOrgName("");
      assert.strictEqual(emptyResult.valid, false);
      assert.strictEqual(emptyResult.error, "Organization name cannot be empty");

      // Test whitespace-only strings using nat to generate varying lengths
      fc.assert(
        fc.property(
          fc.nat({ max: 20 }).map((n) => " ".repeat(n + 1)),
          (whitespace) => {
            const result = validateOrgName(whitespace);
            assert.strictEqual(result.valid, false, `Whitespace-only should be invalid`);
            assert.strictEqual(result.error, "Organization name cannot be empty");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should reject strings longer than 100 characters after trim", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 101, maxLength: 200 }).filter((s) => s.trim().length > 100),
          (longName) => {
            const result = validateOrgName(longName);
            assert.strictEqual(result.valid, false, `Long name should be invalid`);
            assert.strictEqual(result.error, "Organization name must be under 100 characters");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should reject empty string", () => {
      const result = validateOrgName("");
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Organization name cannot be empty");
    });

    it("should accept exactly 100 character name", () => {
      const name = "a".repeat(100);
      const result = validateOrgName(name);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it("should reject 101 character name", () => {
      const name = "a".repeat(101);
      const result = validateOrgName(name);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Organization name must be under 100 characters");
    });

    it("should validate names after trimming whitespace", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 90 }).filter((s) => s.trim().length > 0),
          (name) => {
            const paddedName = `   ${name}   `;
            const result = validateOrgName(paddedName);
            // Should be valid if trimmed length is <= 100
            const trimmedLength = paddedName.trim().length;
            assert.strictEqual(result.valid, trimmedLength > 0 && trimmedLength <= 100);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Mentorship Pair Deletion", () => {
    describe("Cascade Behavior", () => {
      it("should remove pair and all associated logs on deletion", () => {
        fc.assert(
          fc.property(mentorshipPairArb, fc.integer({ min: 0, max: 10 }), (pair, logCount) => {
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
          }),
          { numRuns: 100 }
        );
      });

      it("should not affect other pairs or their logs", () => {
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

      it("should return error when deleting non-existent pair", () => {
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

    describe("Authorization", () => {
      it("should only allow admin users to delete mentorship pairs", () => {
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

      it("should not allow admin to delete pairs from other organizations", () => {
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

      it("should have authorization check consistent with isAdmin flag", () => {
        fc.assert(
          fc.property(mentorshipPairArb, fc.boolean(), (pair, isAdmin) => {
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
  });
});
