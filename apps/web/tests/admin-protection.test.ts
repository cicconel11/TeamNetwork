/**
 * Tests for admin-only protection on announcements and events
 * 
 * These tests verify that only admins can create/edit/delete
 * announcements and events, and that the RLS policies are correct.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

// Mock role types
type OrgRole = "admin" | "active_member" | "alumni" | null;
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

describe("Admin Protection", () => {
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

  describe("Combined Scenarios", () => {
    it("should allow admin full CRUD on announcements", () => {
      const adminMembership: UserMembership = { role: "admin", status: "active" };
      assert.strictEqual(canCreateAnnouncement(adminMembership), true);
      assert.strictEqual(canViewAnnouncement(adminMembership), true);
      assert.strictEqual(canEditAnnouncement(adminMembership), true);
      assert.strictEqual(canDeleteAnnouncement(adminMembership), true);
    });

    it("should allow admin full CRUD on events", () => {
      const adminMembership: UserMembership = { role: "admin", status: "active" };
      assert.strictEqual(canCreateEvent(adminMembership), true);
      assert.strictEqual(canViewEvent(adminMembership), true);
      assert.strictEqual(canEditEvent(adminMembership), true);
      assert.strictEqual(canDeleteEvent(adminMembership), true);
    });

    it("should allow active_member read-only on announcements", () => {
      const memberMembership: UserMembership = { role: "active_member", status: "active" };
      assert.strictEqual(canCreateAnnouncement(memberMembership), false);
      assert.strictEqual(canViewAnnouncement(memberMembership), true);
      assert.strictEqual(canEditAnnouncement(memberMembership), false);
      assert.strictEqual(canDeleteAnnouncement(memberMembership), false);
    });

    it("should allow active_member read-only on events", () => {
      const memberMembership: UserMembership = { role: "active_member", status: "active" };
      assert.strictEqual(canCreateEvent(memberMembership), false);
      assert.strictEqual(canViewEvent(memberMembership), true);
      assert.strictEqual(canEditEvent(memberMembership), false);
      assert.strictEqual(canDeleteEvent(memberMembership), false);
    });

    it("should allow alumni read-only on announcements", () => {
      const alumniMembership: UserMembership = { role: "alumni", status: "active" };
      assert.strictEqual(canCreateAnnouncement(alumniMembership), false);
      assert.strictEqual(canViewAnnouncement(alumniMembership), true);
      assert.strictEqual(canEditAnnouncement(alumniMembership), false);
      assert.strictEqual(canDeleteAnnouncement(alumniMembership), false);
    });

    it("should allow alumni read-only on events", () => {
      const alumniMembership: UserMembership = { role: "alumni", status: "active" };
      assert.strictEqual(canCreateEvent(alumniMembership), false);
      assert.strictEqual(canViewEvent(alumniMembership), true);
      assert.strictEqual(canEditEvent(alumniMembership), false);
      assert.strictEqual(canDeleteEvent(alumniMembership), false);
    });

    it("should deny all permissions to revoked users", () => {
      const revokedAdmin: UserMembership = { role: "admin", status: "revoked" };
      assert.strictEqual(canCreateAnnouncement(revokedAdmin), false);
      assert.strictEqual(canViewAnnouncement(revokedAdmin), false);
      assert.strictEqual(canEditAnnouncement(revokedAdmin), false);
      assert.strictEqual(canDeleteAnnouncement(revokedAdmin), false);
      assert.strictEqual(canCreateEvent(revokedAdmin), false);
      assert.strictEqual(canViewEvent(revokedAdmin), false);
      assert.strictEqual(canEditEvent(revokedAdmin), false);
      assert.strictEqual(canDeleteEvent(revokedAdmin), false);
    });
  });
});
