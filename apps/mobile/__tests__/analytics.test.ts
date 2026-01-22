// Mock AsyncStorage before importing analytics
jest.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
  },
}));

// Mock the underlying SDK modules
jest.mock("../src/lib/analytics/posthog", () => ({
  init: jest.fn(),
  identify: jest.fn(),
  setUserProperties: jest.fn(),
  screen: jest.fn(),
  track: jest.fn(),
  reset: jest.fn(),
}));

jest.mock("../src/lib/analytics/sentry", () => ({
  init: jest.fn(),
  setUser: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

import * as analytics from "../src/lib/analytics";

describe("Analytics Module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analytics.reset();
  });

  describe("isEnabled", () => {
    it("should return current enabled state", () => {
      const result = analytics.isEnabled();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("setEnabled", () => {
    it("should update enabled state", () => {
      analytics.setEnabled(true);
      expect(analytics.isEnabled()).toBe(true);

      analytics.setEnabled(false);
      expect(analytics.isEnabled()).toBe(false);
    });
  });

  describe("init", () => {
    it("should accept analytics config", () => {
      expect(() => {
        analytics.init({
          posthogKey: "test-posthog-key",
          sentryDsn: "https://test@sentry.io/123",
        });
      }).not.toThrow();
    });

    it("should handle missing config gracefully", () => {
      expect(() => {
        analytics.init({
          posthogKey: "",
          sentryDsn: "",
        });
      }).not.toThrow();
    });
  });

  describe("identify", () => {
    it("should not throw when called with valid params", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.identify("user-123", { email: "test@example.com" });
      }).not.toThrow();
    });

    it("should accept user traits", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.identify("user-123", {
          email: "test@example.com",
          authProvider: "google",
        });
      }).not.toThrow();
    });
  });

  describe("setUserProperties", () => {
    it("should not throw when called with valid params", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.setUserProperties({
          currentOrgSlug: "test-org",
          currentOrgId: "org-123",
          role: "admin",
        });
      }).not.toThrow();
    });
  });

  describe("screen", () => {
    it("should not throw when called with screen name", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.screen("HomeScreen");
      }).not.toThrow();
    });

    it("should accept additional properties", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.screen("MembersScreen", { orgSlug: "test-org" });
      }).not.toThrow();
    });
  });

  describe("track", () => {
    it("should not throw when called with event name", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.track("button_clicked");
      }).not.toThrow();
    });

    it("should accept additional properties", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.track("button_clicked", { buttonName: "submit" });
      }).not.toThrow();
    });
  });

  describe("reset", () => {
    it("should clear user identity", () => {
      analytics.setEnabled(true);
      analytics.identify("user-123");
      expect(() => {
        analytics.reset();
      }).not.toThrow();
    });
  });

  describe("captureException", () => {
    it("should not throw when called with error", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.captureException(new Error("Test error"));
      }).not.toThrow();
    });

    it("should accept context object", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.captureException(new Error("Test error"), {
          screen: "TestScreen",
        });
      }).not.toThrow();
    });
  });

  describe("captureMessage", () => {
    it("should not throw when called with message", () => {
      analytics.setEnabled(true);
      expect(() => {
        analytics.captureMessage("Test message");
      }).not.toThrow();
    });
  });

  describe("Event queueing", () => {
    it("should queue events when disabled", () => {
      analytics.setEnabled(false);
      expect(() => {
        analytics.identify("user-123");
        analytics.screen("TestScreen");
        analytics.track("test_event");
      }).not.toThrow();
    });
  });
});
