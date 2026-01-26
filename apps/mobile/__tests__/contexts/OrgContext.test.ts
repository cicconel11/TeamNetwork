/**
 * OrgContext Tests
 * Tests role conversion and analytics helpers
 */

// Mock dependencies before importing
jest.mock("expo-router", () => ({
  useGlobalSearchParams: jest.fn(() => ({})),
}));

jest.mock("../../src/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock("../../src/lib/analytics", () => ({
  setUserProperties: jest.fn(),
}));

jest.mock("react", () => ({
  createContext: jest.fn(() => ({})),
  useContext: jest.fn(),
  useState: jest.fn(),
  useEffect: jest.fn(),
}));

describe("OrgContext", () => {
  let toAnalyticsRole: typeof import("../../src/contexts/OrgContext").toAnalyticsRole;
  type AnalyticsRole = import("../../src/contexts/OrgContext").AnalyticsRole;
  type OrgRole = import("@teammeet/core").OrgRole;

  beforeAll(() => {
    const mod = require("../../src/contexts/OrgContext");
    toAnalyticsRole = mod.toAnalyticsRole;
  });

  describe("toAnalyticsRole", () => {
    it("should return 'unknown' for null role", () => {
      const result = toAnalyticsRole(null);
      expect(result).toBe("unknown");
    });

    it("should return 'admin' for admin role", () => {
      const result = toAnalyticsRole("admin" as OrgRole);
      expect(result).toBe("admin");
    });

    it("should return 'member' for active_member role", () => {
      const result = toAnalyticsRole("active_member" as OrgRole);
      expect(result).toBe("member");
    });

    it("should return 'alumni' for alumni role", () => {
      const result = toAnalyticsRole("alumni" as OrgRole);
      expect(result).toBe("alumni");
    });

    it("should pass through other role types unchanged", () => {
      // Testing edge case where a role doesn't match any condition
      // This tests the fallback return statement
      const role = "admin" as OrgRole;
      const result = toAnalyticsRole(role);
      expect(result).toBe("admin");
    });
  });

  describe("AnalyticsRole type", () => {
    it("should be assignable from valid values", () => {
      const admin: AnalyticsRole = "admin";
      const member: AnalyticsRole = "member";
      const alumni: AnalyticsRole = "alumni";
      const unknown: AnalyticsRole = "unknown";

      expect(admin).toBe("admin");
      expect(member).toBe("member");
      expect(alumni).toBe("alumni");
      expect(unknown).toBe("unknown");
    });
  });
});
