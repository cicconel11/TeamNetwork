import {
  defaultFeatureFlags,
  getFeatureFlags,
  isFeatureEnabled,
  type FeatureFlags,
} from "../src/lib/featureFlags";

describe("Feature Flags", () => {
  describe("defaultFeatureFlags", () => {
    it("should have all features disabled by default", () => {
      expect(defaultFeatureFlags.alumniEnabled).toBe(false);
      expect(defaultFeatureFlags.donationsEnabled).toBe(false);
      expect(defaultFeatureFlags.recordsEnabled).toBe(false);
      expect(defaultFeatureFlags.formsEnabled).toBe(false);
    });

    it("should have all expected flag keys", () => {
      const expectedKeys: (keyof FeatureFlags)[] = [
        "alumniEnabled",
        "donationsEnabled",
        "recordsEnabled",
        "formsEnabled",
      ];
      expect(Object.keys(defaultFeatureFlags).sort()).toEqual(expectedKeys.sort());
    });
  });

  describe("getFeatureFlags", () => {
    it("should return feature flags object", () => {
      const flags = getFeatureFlags();
      expect(flags).toBeDefined();
      expect(typeof flags.alumniEnabled).toBe("boolean");
      expect(typeof flags.donationsEnabled).toBe("boolean");
      expect(typeof flags.recordsEnabled).toBe("boolean");
      expect(typeof flags.formsEnabled).toBe("boolean");
    });

    it("should return a new object each time (not mutating defaults)", () => {
      const flags1 = getFeatureFlags();
      const flags2 = getFeatureFlags();
      expect(flags1).not.toBe(flags2);
      expect(flags1).toEqual(flags2);
    });

    it("should accept optional orgId parameter", () => {
      const flags = getFeatureFlags("test-org-id");
      expect(flags).toBeDefined();
    });
  });

  describe("isFeatureEnabled", () => {
    it("should return boolean for alumniEnabled flag", () => {
      const result = isFeatureEnabled("alumniEnabled");
      expect(typeof result).toBe("boolean");
    });

    it("should return boolean for donationsEnabled flag", () => {
      const result = isFeatureEnabled("donationsEnabled");
      expect(typeof result).toBe("boolean");
    });

    it("should return boolean for recordsEnabled flag", () => {
      const result = isFeatureEnabled("recordsEnabled");
      expect(typeof result).toBe("boolean");
    });

    it("should return boolean for formsEnabled flag", () => {
      const result = isFeatureEnabled("formsEnabled");
      expect(typeof result).toBe("boolean");
    });

    it("should accept optional orgId parameter", () => {
      const result = isFeatureEnabled("alumniEnabled", "test-org-id");
      expect(typeof result).toBe("boolean");
    });
  });
});
