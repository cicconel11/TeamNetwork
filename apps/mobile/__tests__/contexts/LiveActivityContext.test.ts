/**
 * LiveActivityContext / native bridge tests.
 *
 * The provider itself (LiveActivityProvider) requires a React Native
 * renderer + AuthContext + reanimated, which the current jest harness can't
 * run — see jest.config.js comment about "Full component testing requires
 * Detox/Maestro". We therefore test the smaller, deterministic pieces:
 *
 *   - The native module stub on non-iOS resolves to "not supported" and a
 *     no-op pushTokenListener — guarantees Android + web builds never crash
 *     when the provider mounts.
 */

describe("LiveActivity native bridge stub", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("returns a stub on Android that reports unsupported", async () => {
    jest.doMock("react-native", () => ({
      Platform: { OS: "android" },
    }));
    jest.doMock("expo-modules-core", () => ({
      requireNativeModule: jest.fn(() => {
        throw new Error("not on android");
      }),
    }));

    const { LiveActivityNative, addPushTokenListener } = require("../../modules/live-activity/src");

    await expect(LiveActivityNative.isSupported()).resolves.toBe(false);
    await expect(LiveActivityNative.start({} as never)).resolves.toBeNull();
    await expect(LiveActivityNative.endAll()).resolves.toBeUndefined();

    const sub = addPushTokenListener(() => undefined);
    expect(typeof sub.remove).toBe("function");
    expect(() => sub.remove()).not.toThrow();
  });

  it("falls back to a stub when the native module is missing on iOS", async () => {
    jest.doMock("react-native", () => ({
      Platform: { OS: "ios" },
    }));
    jest.doMock("expo-modules-core", () => ({
      requireNativeModule: jest.fn(() => {
        throw new Error("module not registered");
      }),
    }));

    const { LiveActivityNative, addPushTokenListener } = require("../../modules/live-activity/src");

    await expect(LiveActivityNative.isSupported()).resolves.toBe(false);
    expect(addPushTokenListener(() => undefined).remove).toEqual(
      expect.any(Function),
    );
  });

  it("uses the registered native module when available on iOS", async () => {
    const isSupported = jest.fn().mockResolvedValue(true);
    const start = jest
      .fn()
      .mockResolvedValue({ activityId: "act-1", pushToken: "abcd" });
    const addListener = jest.fn().mockReturnValue({ remove: jest.fn() });

    jest.doMock("react-native", () => ({
      Platform: { OS: "ios" },
    }));
    jest.doMock("expo-modules-core", () => ({
      requireNativeModule: jest.fn(() => ({
        isSupported,
        start,
        update: jest.fn(),
        end: jest.fn(),
        endAll: jest.fn(),
        listActive: jest.fn().mockResolvedValue([]),
        addListener,
      })),
    }));

    const { LiveActivityNative, addPushTokenListener } = require("../../modules/live-activity/src");

    await expect(LiveActivityNative.isSupported()).resolves.toBe(true);
    expect(isSupported).toHaveBeenCalled();

    const handler = jest.fn();
    addPushTokenListener(handler);
    expect(addListener).toHaveBeenCalledWith(
      "onPushTokenUpdate",
      expect.any(Function),
    );
  });
});
