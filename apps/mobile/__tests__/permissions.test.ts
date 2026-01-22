import {
  canViewAlumni,
  canUseAdminActions,
  canViewDonations,
  canViewRecords,
  canViewForms,
  canAccessSettings,
  canManageInvites,
  canManageBilling,
  getPermissions,
  DEFAULT_FEATURE_FLAGS,
} from "@teammeet/core";

describe("Permission Helpers", () => {
  describe("canViewAlumni", () => {
    it("should return false when role is null", () => {
      expect(canViewAlumni(null, { alumniEnabled: true })).toBe(false);
    });

    it("should return false when alumniEnabled is false", () => {
      expect(canViewAlumni("admin", { alumniEnabled: false })).toBe(false);
      expect(canViewAlumni("active_member", { alumniEnabled: false })).toBe(false);
      expect(canViewAlumni("alumni", { alumniEnabled: false })).toBe(false);
    });

    it("should return true for all roles when alumniEnabled is true", () => {
      expect(canViewAlumni("admin", { alumniEnabled: true })).toBe(true);
      expect(canViewAlumni("active_member", { alumniEnabled: true })).toBe(true);
      expect(canViewAlumni("alumni", { alumniEnabled: true })).toBe(true);
    });
  });

  describe("canUseAdminActions", () => {
    it("should return true only for admin role", () => {
      expect(canUseAdminActions("admin")).toBe(true);
      expect(canUseAdminActions("active_member")).toBe(false);
      expect(canUseAdminActions("alumni")).toBe(false);
      expect(canUseAdminActions(null)).toBe(false);
    });
  });

  describe("canViewDonations", () => {
    it("should return false when role is null", () => {
      expect(canViewDonations(null, { donationsEnabled: true })).toBe(false);
    });

    it("should return false when donationsEnabled is false", () => {
      expect(canViewDonations("admin", { donationsEnabled: false })).toBe(false);
    });

    it("should return true when donationsEnabled is true and has valid role", () => {
      expect(canViewDonations("admin", { donationsEnabled: true })).toBe(true);
      expect(canViewDonations("active_member", { donationsEnabled: true })).toBe(true);
    });
  });

  describe("canViewRecords", () => {
    it("should return false when role is null", () => {
      expect(canViewRecords(null, { recordsEnabled: true })).toBe(false);
    });

    it("should return false when recordsEnabled is false", () => {
      expect(canViewRecords("admin", { recordsEnabled: false })).toBe(false);
    });

    it("should return true when recordsEnabled is true and has valid role", () => {
      expect(canViewRecords("admin", { recordsEnabled: true })).toBe(true);
    });
  });

  describe("canViewForms", () => {
    it("should return false when role is null", () => {
      expect(canViewForms(null, { formsEnabled: true })).toBe(false);
    });

    it("should return false when formsEnabled is false", () => {
      expect(canViewForms("admin", { formsEnabled: false })).toBe(false);
    });

    it("should return true when formsEnabled is true and has valid role", () => {
      expect(canViewForms("admin", { formsEnabled: true })).toBe(true);
    });
  });

  describe("Admin-only permissions", () => {
    it("canAccessSettings should return true only for admin", () => {
      expect(canAccessSettings("admin")).toBe(true);
      expect(canAccessSettings("active_member")).toBe(false);
      expect(canAccessSettings("alumni")).toBe(false);
      expect(canAccessSettings(null)).toBe(false);
    });

    it("canManageInvites should return true only for admin", () => {
      expect(canManageInvites("admin")).toBe(true);
      expect(canManageInvites("active_member")).toBe(false);
      expect(canManageInvites("alumni")).toBe(false);
      expect(canManageInvites(null)).toBe(false);
    });

    it("canManageBilling should return true only for admin", () => {
      expect(canManageBilling("admin")).toBe(true);
      expect(canManageBilling("active_member")).toBe(false);
      expect(canManageBilling("alumni")).toBe(false);
      expect(canManageBilling(null)).toBe(false);
    });
  });

  describe("getPermissions", () => {
    it("should return all permission values for admin", () => {
      const permissions = getPermissions("admin", {
        alumniEnabled: true,
        donationsEnabled: true,
        recordsEnabled: true,
        formsEnabled: true,
      });

      expect(permissions.canViewAlumni).toBe(true);
      expect(permissions.canUseAdminActions).toBe(true);
      expect(permissions.canViewDonations).toBe(true);
      expect(permissions.canViewRecords).toBe(true);
      expect(permissions.canViewForms).toBe(true);
      expect(permissions.canAccessSettings).toBe(true);
      expect(permissions.canManageInvites).toBe(true);
      expect(permissions.canManageBilling).toBe(true);
    });

    it("should return limited permissions for active_member", () => {
      const permissions = getPermissions("active_member", {
        alumniEnabled: true,
        donationsEnabled: true,
      });

      expect(permissions.canViewAlumni).toBe(true);
      expect(permissions.canUseAdminActions).toBe(false);
      expect(permissions.canViewDonations).toBe(true);
      expect(permissions.canAccessSettings).toBe(false);
      expect(permissions.canManageInvites).toBe(false);
      expect(permissions.canManageBilling).toBe(false);
    });

    it("should return no permissions for null role", () => {
      const permissions = getPermissions(null);

      expect(permissions.canViewAlumni).toBe(false);
      expect(permissions.canUseAdminActions).toBe(false);
      expect(permissions.canViewDonations).toBe(false);
      expect(permissions.canViewRecords).toBe(false);
      expect(permissions.canViewForms).toBe(false);
      expect(permissions.canAccessSettings).toBe(false);
      expect(permissions.canManageInvites).toBe(false);
      expect(permissions.canManageBilling).toBe(false);
    });
  });

  describe("DEFAULT_FEATURE_FLAGS", () => {
    it("should have all features disabled by default", () => {
      expect(DEFAULT_FEATURE_FLAGS.alumniEnabled).toBe(false);
      expect(DEFAULT_FEATURE_FLAGS.donationsEnabled).toBe(false);
      expect(DEFAULT_FEATURE_FLAGS.recordsEnabled).toBe(false);
      expect(DEFAULT_FEATURE_FLAGS.formsEnabled).toBe(false);
    });
  });
});
