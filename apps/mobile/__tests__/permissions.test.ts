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
  type FeatureFlags,
} from "@/lib/permissions";

const enabledFlags: FeatureFlags = {
  alumniEnabled: true,
  donationsEnabled: true,
  recordsEnabled: true,
  formsEnabled: true,
};

const roles = ["admin", "active_member", "alumni"] as const;

describe("Permission Helpers", () => {
  describe("canViewAlumni", () => {
    it("returns false when role is null", () => {
      expect(canViewAlumni(null, { alumniEnabled: true })).toBe(false);
    });

    it("returns false when alumniEnabled is false", () => {
      for (const role of roles) {
        expect(canViewAlumni(role, { alumniEnabled: false })).toBe(false);
      }
    });

    it("returns true for any role when alumniEnabled is true", () => {
      for (const role of roles) {
        expect(canViewAlumni(role, { alumniEnabled: true })).toBe(true);
      }
    });
  });

  describe("canUseAdminActions", () => {
    it("returns true only for admin", () => {
      expect(canUseAdminActions("admin")).toBe(true);
      expect(canUseAdminActions("active_member")).toBe(false);
      expect(canUseAdminActions("alumni")).toBe(false);
      expect(canUseAdminActions(null)).toBe(false);
    });
  });

  describe("canViewDonations", () => {
    it("returns false when role is null", () => {
      expect(canViewDonations(null, { donationsEnabled: true })).toBe(false);
    });

    it("returns false when donationsEnabled is false", () => {
      for (const role of roles) {
        expect(canViewDonations(role, { donationsEnabled: false })).toBe(false);
      }
    });

    it("returns true for any role when donationsEnabled is true", () => {
      for (const role of roles) {
        expect(canViewDonations(role, { donationsEnabled: true })).toBe(true);
      }
    });
  });

  describe("canViewRecords", () => {
    it("returns false when role is null", () => {
      expect(canViewRecords(null, { recordsEnabled: true })).toBe(false);
    });

    it("returns false when recordsEnabled is false", () => {
      for (const role of roles) {
        expect(canViewRecords(role, { recordsEnabled: false })).toBe(false);
      }
    });

    it("returns true for any role when recordsEnabled is true", () => {
      for (const role of roles) {
        expect(canViewRecords(role, { recordsEnabled: true })).toBe(true);
      }
    });
  });

  describe("canViewForms", () => {
    it("returns false when role is null", () => {
      expect(canViewForms(null, { formsEnabled: true })).toBe(false);
    });

    it("returns false when formsEnabled is false", () => {
      for (const role of roles) {
        expect(canViewForms(role, { formsEnabled: false })).toBe(false);
      }
    });

    it("returns true for any role when formsEnabled is true", () => {
      for (const role of roles) {
        expect(canViewForms(role, { formsEnabled: true })).toBe(true);
      }
    });
  });

  describe("Admin-only permissions", () => {
    it("restricts admin settings and management actions", () => {
      expect(canAccessSettings("admin")).toBe(true);
      expect(canManageInvites("admin")).toBe(true);
      expect(canManageBilling("admin")).toBe(true);

      expect(canAccessSettings("active_member")).toBe(false);
      expect(canManageInvites("active_member")).toBe(false);
      expect(canManageBilling("active_member")).toBe(false);

      expect(canAccessSettings("alumni")).toBe(false);
      expect(canManageInvites("alumni")).toBe(false);
      expect(canManageBilling("alumni")).toBe(false);

      expect(canAccessSettings(null)).toBe(false);
      expect(canManageInvites(null)).toBe(false);
      expect(canManageBilling(null)).toBe(false);
    });
  });

  describe("getPermissions", () => {
    it("returns all permissions for admin when features are enabled", () => {
      const permissions = getPermissions("admin", enabledFlags);
      expect(permissions).toEqual({
        canViewAlumni: true,
        canUseAdminActions: true,
        canViewDonations: true,
        canViewRecords: true,
        canViewForms: true,
        canAccessSettings: true,
        canManageInvites: true,
        canManageBilling: true,
      });
    });

    it("returns feature permissions for active members", () => {
      const permissions = getPermissions("active_member", enabledFlags);
      expect(permissions).toEqual({
        canViewAlumni: true,
        canUseAdminActions: false,
        canViewDonations: true,
        canViewRecords: true,
        canViewForms: true,
        canAccessSettings: false,
        canManageInvites: false,
        canManageBilling: false,
      });
    });

    it("returns feature permissions for alumni", () => {
      const permissions = getPermissions("alumni", enabledFlags);
      expect(permissions).toEqual({
        canViewAlumni: true,
        canUseAdminActions: false,
        canViewDonations: true,
        canViewRecords: true,
        canViewForms: true,
        canAccessSettings: false,
        canManageInvites: false,
        canManageBilling: false,
      });
    });

    it("returns no permissions for null role", () => {
      const permissions = getPermissions(null, enabledFlags);
      expect(permissions).toEqual({
        canViewAlumni: false,
        canUseAdminActions: false,
        canViewDonations: false,
        canViewRecords: false,
        canViewForms: false,
        canAccessSettings: false,
        canManageInvites: false,
        canManageBilling: false,
      });
    });

    it("defaults missing flags to false", () => {
      const permissions = getPermissions("admin", { alumniEnabled: true });
      expect(permissions.canViewAlumni).toBe(true);
      expect(permissions.canViewDonations).toBe(false);
      expect(permissions.canViewRecords).toBe(false);
      expect(permissions.canViewForms).toBe(false);
    });
  });

  describe("DEFAULT_FEATURE_FLAGS", () => {
    it("has all features disabled by default", () => {
      expect(DEFAULT_FEATURE_FLAGS).toEqual({
        alumniEnabled: false,
        donationsEnabled: false,
        recordsEnabled: false,
        formsEnabled: false,
      });
    });
  });
});
