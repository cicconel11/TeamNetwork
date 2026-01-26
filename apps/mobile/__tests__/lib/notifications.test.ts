/**
 * Notifications Library Tests
 * Tests notification route parsing and helper functions
 */

// Mock all dependencies before importing
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock("expo-device", () => ({
  isDevice: true,
}));

jest.mock("expo-application", () => ({
  getIosIdForVendorAsync: jest.fn(),
  getAndroidId: jest.fn(),
}));

jest.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {
        eas: { projectId: "test-project-id" },
      },
    },
  },
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

jest.mock("../../src/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock("../../src/lib/analytics", () => ({
  captureException: jest.fn(),
}));

describe("Notifications Library", () => {
  let getNotificationRoute: typeof import("../../src/lib/notifications").getNotificationRoute;
  type NotificationData =
    import("../../src/lib/notifications").NotificationData;

  beforeAll(() => {
    const mod = require("../../src/lib/notifications");
    getNotificationRoute = mod.getNotificationRoute;
  });

  describe("getNotificationRoute", () => {
    it("should return announcement route for announcement type", () => {
      const data: NotificationData = {
        type: "announcement",
        orgSlug: "test-org",
        id: "ann-123",
      };
      const route = getNotificationRoute(data);
      expect(route).toBe("/(app)/test-org/announcements/ann-123");
    });

    it("should return event route for event type", () => {
      const data: NotificationData = {
        type: "event",
        orgSlug: "my-team",
        id: "evt-456",
      };
      const route = getNotificationRoute(data);
      expect(route).toBe("/(app)/my-team/events/evt-456");
    });

    it("should return null when orgSlug is missing", () => {
      const data: NotificationData = {
        type: "announcement",
        orgSlug: "",
        id: "ann-123",
      };
      const route = getNotificationRoute(data);
      expect(route).toBeNull();
    });

    it("should return null when type is missing", () => {
      const data = {
        type: "" as "announcement" | "event",
        orgSlug: "test-org",
        id: "ann-123",
      } as NotificationData;
      const route = getNotificationRoute(data);
      expect(route).toBeNull();
    });

    it("should return null when id is missing", () => {
      const data: NotificationData = {
        type: "announcement",
        orgSlug: "test-org",
        id: "",
      };
      const route = getNotificationRoute(data);
      expect(route).toBeNull();
    });

    it("should return null for unknown notification type", () => {
      const data = {
        type: "unknown" as "announcement" | "event",
        orgSlug: "test-org",
        id: "123",
      } as NotificationData;
      const route = getNotificationRoute(data);
      expect(route).toBeNull();
    });

    it("should handle special characters in orgSlug", () => {
      const data: NotificationData = {
        type: "announcement",
        orgSlug: "test-org-2024",
        id: "ann-123",
      };
      const route = getNotificationRoute(data);
      expect(route).toBe("/(app)/test-org-2024/announcements/ann-123");
    });

    it("should handle UUID format ids", () => {
      const data: NotificationData = {
        type: "event",
        orgSlug: "org",
        id: "550e8400-e29b-41d4-a716-446655440000",
      };
      const route = getNotificationRoute(data);
      expect(route).toBe(
        "/(app)/org/events/550e8400-e29b-41d4-a716-446655440000"
      );
    });

    it("should preserve optional title and body fields", () => {
      const data: NotificationData = {
        type: "announcement",
        orgSlug: "test-org",
        id: "ann-123",
        title: "Test Title",
        body: "Test body content",
      };
      // These fields don't affect routing but should be valid
      expect(data.title).toBe("Test Title");
      expect(data.body).toBe("Test body content");
      const route = getNotificationRoute(data);
      expect(route).toBe("/(app)/test-org/announcements/ann-123");
    });
  });
});

describe("NotificationData Type", () => {
  it("should have correct type discriminants", () => {
    type NotificationData =
      import("../../src/lib/notifications").NotificationData;

    const announcementData: NotificationData = {
      type: "announcement",
      orgSlug: "test",
      id: "123",
    };
    expect(announcementData.type).toBe("announcement");

    const eventData: NotificationData = {
      type: "event",
      orgSlug: "test",
      id: "456",
    };
    expect(eventData.type).toBe("event");
  });
});
