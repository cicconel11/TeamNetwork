/**
 * Analytics Module Tests
 * Tests event queueing, SDK initialization, and enabled state
 */

// Mock modules before importing
jest.mock("@react-native-async-storage/async-storage", () => {
  return {
    __esModule: true,
    default: {
      setItem: jest.fn(() => Promise.resolve()),
      getItem: jest.fn(() => Promise.resolve(null)),
      removeItem: jest.fn(() => Promise.resolve()),
    },
  };
});

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

const VALID_CONFIG = {
  posthogKey: "test-posthog-key",
  sentryDsn: "https://test@sentry.io/123",
};

describe("Analytics Module", () => {
  let analytics: typeof import("../src/lib/analytics");
  let posthog: typeof import("../src/lib/analytics/posthog");
  let sentry: typeof import("../src/lib/analytics/sentry");
  let asyncStorage: { setItem: jest.Mock; getItem: jest.Mock };

  beforeEach(() => {
    // Reset modules to get fresh state for each test
    jest.resetModules();

    // Re-import mocks after reset
    asyncStorage =
      require("@react-native-async-storage/async-storage").default;
    posthog = require("../src/lib/analytics/posthog");
    sentry = require("../src/lib/analytics/sentry");
    analytics = require("../src/lib/analytics");

    // Clear mock call history
    jest.clearAllMocks();
  });

  it("starts disabled in __DEV__", () => {
    expect(analytics.isEnabled()).toBe(false);
  });

  it("does not initialize SDKs while disabled", () => {
    analytics.init(VALID_CONFIG);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initializes SDKs when enabled with valid config", () => {
    analytics.setEnabled(true);
    analytics.init(VALID_CONFIG);
    expect(posthog.init).toHaveBeenCalledWith(VALID_CONFIG.posthogKey);
    expect(sentry.init).toHaveBeenCalledWith(VALID_CONFIG.sentryDsn);
  });

  it("queues events before init and flushes after init", () => {
    analytics.setEnabled(true);

    analytics.identify("user-123", { email: "test@example.com" });
    analytics.track("button_clicked", { buttonName: "submit" });

    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.track).not.toHaveBeenCalled();

    analytics.init(VALID_CONFIG);

    expect(posthog.identify).toHaveBeenCalledWith("user-123", {
      email: "test@example.com",
    });
    expect(sentry.setUser).toHaveBeenCalledWith({
      id: "user-123",
      email: "test@example.com",
    });
    expect(posthog.track).toHaveBeenCalledWith("button_clicked", {
      buttonName: "submit",
    });
  });

  it("sends events immediately after init", () => {
    analytics.setEnabled(true);
    analytics.init(VALID_CONFIG);

    analytics.screen("HomeScreen", { orgSlug: "test-org" });
    analytics.setUserProperties({
      currentOrgSlug: "test-org",
      currentOrgId: "org-123",
      role: "admin",
    });

    expect(posthog.screen).toHaveBeenCalledWith("HomeScreen", {
      orgSlug: "test-org",
    });
    expect(posthog.setUserProperties).toHaveBeenCalledWith({
      currentOrgSlug: "test-org",
      currentOrgId: "org-123",
      role: "admin",
    });
  });

  it("resets SDKs when disabling after init", () => {
    analytics.setEnabled(true);
    analytics.init(VALID_CONFIG);
    analytics.setEnabled(false);
    expect(posthog.reset).toHaveBeenCalled();
    expect(sentry.setUser).toHaveBeenCalledWith(null);
  });

  it("persists enabled state changes", () => {
    analytics.setEnabled(true);
    expect(asyncStorage.setItem).toHaveBeenCalledWith(
      "analytics.enabled",
      "true"
    );
    analytics.setEnabled(false);
    expect(asyncStorage.setItem).toHaveBeenCalledWith(
      "analytics.enabled",
      "false"
    );
  });

  it("does not send errors before init", () => {
    analytics.setEnabled(true);
    analytics.captureException(new Error("Test error"));
    analytics.captureMessage("Test message");
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("sends errors after init", () => {
    analytics.setEnabled(true);
    analytics.init(VALID_CONFIG);

    const error = new Error("Test error");
    analytics.captureException(error, { screen: "TestScreen" });
    analytics.captureMessage("Test message");

    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      screen: "TestScreen",
    });
    expect(sentry.captureMessage).toHaveBeenCalledWith("Test message");
  });

  it("hydrates enabled state from storage", async () => {
    asyncStorage.getItem.mockResolvedValueOnce("true");
    await analytics.hydrateEnabled();
    expect(analytics.isEnabled()).toBe(true);
  });
});
