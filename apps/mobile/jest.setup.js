/**
 * Jest Setup File
 * Configures testing environment and global mocks
 */

// Import testing library extensions
import "@testing-library/jest-native/extend-expect";

// Mock reanimated
jest.mock("react-native-reanimated", () => {
  const Reanimated = require("react-native-reanimated/mock");
  Reanimated.default.call = () => {};
  return Reanimated;
});

// Mock expo modules
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: "ExponentPushToken[mock]" }),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getBadgeCountAsync: jest.fn().mockResolvedValue(0),
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("mock-notification-id"),
  AndroidImportance: {
    MAX: 5,
    HIGH: 4,
    DEFAULT: 3,
    LOW: 2,
    MIN: 1,
  },
}));

jest.mock("expo-device", () => ({
  isDevice: true,
  modelName: "Mock Device",
}));

jest.mock("expo-application", () => ({
  getIosIdForVendorAsync: jest.fn().mockResolvedValue("mock-ios-vendor-id"),
  getAndroidId: jest.fn().mockReturnValue("mock-android-id"),
}));

jest.mock("expo-constants", () => ({
  expoConfig: {
    extra: {
      eas: {
        projectId: "mock-project-id",
      },
    },
  },
  deviceId: "mock-device-id",
}));

jest.mock("expo-router", () => ({
  useGlobalSearchParams: jest.fn().mockReturnValue({}),
  useLocalSearchParams: jest.fn().mockReturnValue({}),
  useRouter: jest.fn().mockReturnValue({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useSegments: jest.fn().mockReturnValue([]),
  usePathname: jest.fn().mockReturnValue("/"),
  Link: "Link",
  Stack: {
    Screen: "Screen",
  },
}));

jest.mock("expo-linking", () => ({
  createURL: jest.fn((path) => `exp://mock/${path}`),
  openURL: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-file-system", () => ({
  documentDirectory: "file://mock/documents/",
  cacheDirectory: "file://mock/cache/",
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(),
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: "LinearGradient",
}));

// Mock @react-native-async-storage/async-storage
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// Mock Supabase
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "test-user-id", email: "test@example.com" } },
        error: null,
      }),
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: "mock-token" } },
        error: null,
      }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    })),
    removeChannel: jest.fn(),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ data: { path: "mock-path" }, error: null }),
        remove: jest.fn().mockResolvedValue({ data: null, error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: "https://mock-signed-url.com/file" },
          error: null,
        }),
      })),
    },
  },
}));

// Mock analytics
jest.mock("@/lib/analytics", () => ({
  identify: jest.fn(),
  reset: jest.fn(),
  track: jest.fn(),
  screen: jest.fn(),
  setUserProperties: jest.fn(),
  captureException: jest.fn(),
  setEnabled: jest.fn(),
  isEnabled: jest.fn().mockReturnValue(false),
}));

// Suppress console warnings in tests
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(() => {
  console.warn = (...args) => {
    if (
      typeof args[0] === "string" &&
      (args[0].includes("Animated") ||
        args[0].includes("NativeEventEmitter") ||
        args[0].includes("useNativeDriver"))
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
  console.error = (...args) => {
    if (
      typeof args[0] === "string" &&
      (args[0].includes("Warning:") || args[0].includes("act("))
    ) {
      return;
    }
    originalError.apply(console, args);
  };
});

afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});
