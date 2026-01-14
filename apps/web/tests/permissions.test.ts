/**
 * Consolidated Permission Tests
 *
 * Tests for role-based permissions including:
 * - Role normalization
 * - Announcement CRUD permissions
 * - Event CRUD permissions
 * - Organization settings editability
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { canEditOrgName } from "../src/lib/validation/role-editability.ts";
import type { OrgRole } from "../src/lib/auth/role-utils.ts";

// Mock role types
type MembershipStatus = "active" | "revoked";

interface UserMembership {
  role: OrgRole;
  status: MembershipStatus;
}

// Role checking functions (mirror the actual implementation)
function normalizeRole(role: string | null): OrgRole {
  if (!role) return null;
  if (role === "member") return "active_member";
  if (role === "viewer") return "alumni";
  if (role === "admin" || role === "active_member" || role === "alumni") {
    return role;
  }
  return null;
}

function canCreateAnnouncement(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role === "admin";
}

function canEditAnnouncement(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role === "admin";
}

function canDeleteAnnouncement(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role === "admin";
}

function canViewAnnouncement(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role !== null;
}

function canCreateEvent(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role === "admin";
}

function canEditEvent(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role === "admin";
}

function canDeleteEvent(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role === "admin";
}

function canViewEvent(membership: UserMembership | null): boolean {
  if (!membership) return false;
  if (membership.status === "revoked") return false;
  return membership.role !== null;
}

describe("Role Permissions", () => {
  describe("normalizeRole", () => {
    it("should normalize 'member' to 'active_member'", () => {
      assert.strictEqual(normalizeRole("member"), "active_member");
    });

    it("should normalize 'viewer' to 'alumni'", () => {
      assert.strictEqual(normalizeRole("viewer"), "alumni");
    });

    it("should keep valid roles unchanged", () => {
      assert.strictEqual(normalizeRole("admin"), "admin");
      assert.strictEqual(normalizeRole("active_member"), "active_member");
      assert.strictEqual(normalizeRole("alumni"), "alumni");
    });

    it("should return null for null input", () => {
      assert.strictEqual(normalizeRole(null), null);
    });

    it("should return null for unknown roles", () => {
      assert.strictEqual(normalizeRole("unknown"), null);
    });
  });

  describe("Announcement Permissions", () => {
    describe("canCreateAnnouncement", () => {
      it("should allow admin to create", () => {
        assert.strictEqual(canCreateAnnouncement({ role: "admin", status: "active" }), true);
      });

      it("should deny active_member from creating", () => {
        assert.strictEqual(canCreateAnnouncement({ role: "active_member", status: "active" }), false);
      });

      it("should deny alumni from creating", () => {
        assert.strictEqual(canCreateAnnouncement({ role: "alumni", status: "active" }), false);
      });

      it("should deny null membership", () => {
        assert.strictEqual(canCreateAnnouncement(null), false);
      });

      it("should deny revoked admin", () => {
        assert.strictEqual(canCreateAnnouncement({ role: "admin", status: "revoked" }), false);
      });
    });

    describe("canEditAnnouncement", () => {
      it("should allow admin to edit", () => {
        assert.strictEqual(canEditAnnouncement({ role: "admin", status: "active" }), true);
      });

      it("should deny active_member from editing", () => {
        assert.strictEqual(canEditAnnouncement({ role: "active_member", status: "active" }), false);
      });

      it("should deny alumni from editing", () => {
        assert.strictEqual(canEditAnnouncement({ role: "alumni", status: "active" }), false);
      });
    });

    describe("canDeleteAnnouncement", () => {
      it("should allow admin to delete", () => {
        assert.strictEqual(canDeleteAnnouncement({ role: "admin", status: "active" }), true);
      });

      it("should deny active_member from deleting", () => {
        assert.strictEqual(canDeleteAnnouncement({ role: "active_member", status: "active" }), false);
      });

      it("should deny alumni from deleting", () => {
        assert.strictEqual(canDeleteAnnouncement({ role: "alumni", status: "active" }), false);
      });
    });

    describe("canViewAnnouncement", () => {
      it("should allow admin to view", () => {
        assert.strictEqual(canViewAnnouncement({ role: "admin", status: "active" }), true);
      });

      it("should allow active_member to view", () => {
        assert.strictEqual(canViewAnnouncement({ role: "active_member", status: "active" }), true);
      });

      it("should allow alumni to view", () => {
        assert.strictEqual(canViewAnnouncement({ role: "alumni", status: "active" }), true);
      });

      it("should deny null membership from viewing", () => {
        assert.strictEqual(canViewAnnouncement(null), false);
      });

      it("should deny revoked users from viewing", () => {
        assert.strictEqual(canViewAnnouncement({ role: "admin", status: "revoked" }), false);
        assert.strictEqual(canViewAnnouncement({ role: "active_member", status: "revoked" }), false);
        assert.strictEqual(canViewAnnouncement({ role: "alumni", status: "revoked" }), false);
      });
    });
  });

  describe("Event Permissions", () => {
    describe("canCreateEvent", () => {
      it("should allow admin to create", () => {
        assert.strictEqual(canCreateEvent({ role: "admin", status: "active" }), true);
      });

      it("should deny active_member from creating", () => {
        assert.strictEqual(canCreateEvent({ role: "active_member", status: "active" }), false);
      });

      it("should deny alumni from creating", () => {
        assert.strictEqual(canCreateEvent({ role: "alumni", status: "active" }), false);
      });

      it("should deny null membership", () => {
        assert.strictEqual(canCreateEvent(null), false);
      });

      it("should deny revoked admin", () => {
        assert.strictEqual(canCreateEvent({ role: "admin", status: "revoked" }), false);
      });
    });

    describe("canEditEvent", () => {
      it("should allow admin to edit", () => {
        assert.strictEqual(canEditEvent({ role: "admin", status: "active" }), true);
      });

      it("should deny active_member from editing", () => {
        assert.strictEqual(canEditEvent({ role: "active_member", status: "active" }), false);
      });

      it("should deny alumni from editing", () => {
        assert.strictEqual(canEditEvent({ role: "alumni", status: "active" }), false);
      });
    });

    describe("canDeleteEvent", () => {
      it("should allow admin to delete", () => {
        assert.strictEqual(canDeleteEvent({ role: "admin", status: "active" }), true);
      });

      it("should deny active_member from deleting", () => {
        assert.strictEqual(canDeleteEvent({ role: "active_member", status: "active" }), false);
      });

      it("should deny alumni from deleting", () => {
        assert.strictEqual(canDeleteEvent({ role: "alumni", status: "active" }), false);
      });
    });

    describe("canViewEvent", () => {
      it("should allow admin to view", () => {
        assert.strictEqual(canViewEvent({ role: "admin", status: "active" }), true);
      });

      it("should allow active_member to view", () => {
        assert.strictEqual(canViewEvent({ role: "active_member", status: "active" }), true);
      });

      it("should allow alumni to view", () => {
        assert.strictEqual(canViewEvent({ role: "alumni", status: "active" }), true);
      });

      it("should deny null membership from viewing", () => {
        assert.strictEqual(canViewEvent(null), false);
      });

      it("should deny revoked users from viewing", () => {
        assert.strictEqual(canViewEvent({ role: "admin", status: "revoked" }), false);
        assert.strictEqual(canViewEvent({ role: "active_member", status: "revoked" }), false);
        assert.strictEqual(canViewEvent({ role: "alumni", status: "revoked" }), false);
      });
    });
  });

  describe("Organization Settings", () => {
    describe("canEditOrgName", () => {
      const allRoles: (OrgRole | null)[] = ["admin", "active_member", "alumni", null];

      it("should allow admin role to edit organization name", () => {
        const result = canEditOrgName("admin");
        assert.strictEqual(result, true, "Admin should be able to edit org name");
      });

      it("should deny non-admin roles from editing organization name", () => {
        fc.assert(
          fc.property(
            fc.constantFrom<OrgRole | null>("active_member", "alumni", null),
            (role) => {
              const result = canEditOrgName(role);
              assert.strictEqual(result, false, `Role "${role}" should not be able to edit org name`);
            }
          ),
          { numRuns: 100 }
        );
      });

      it("should have editability true iff role is admin", () => {
        fc.assert(
          fc.property(
            fc.constantFrom(...allRoles),
            (role) => {
              const canEdit = canEditOrgName(role);
              const isAdmin = role === "admin";
              assert.strictEqual(canEdit, isAdmin, `canEdit should equal isAdmin for role "${role}"`);
            }
          ),
          { numRuns: 100 }
        );
      });

      it("should deny null role from editing", () => {
        const result = canEditOrgName(null);
        assert.strictEqual(result, false, "Null role should not be able to edit");
      });
    });
  });
});
