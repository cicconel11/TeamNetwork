import { captureCurrentCoords } from "../../src/lib/event-location";

jest.mock("expo-location", () => ({
  hasServicesEnabledAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock("../../src/lib/analytics/sentry", () => ({
  captureException: jest.fn(),
}));

import * as Location from "expo-location";

const mocks = Location as unknown as {
  hasServicesEnabledAsync: jest.Mock;
  requestForegroundPermissionsAsync: jest.Mock;
  getCurrentPositionAsync: jest.Mock;
};

describe("captureCurrentCoords", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns ok=true with coords when permission granted and services on", async () => {
    mocks.hasServicesEnabledAsync.mockResolvedValue(true);
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mocks.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 37.7749, longitude: -122.4194 },
    });

    const result = await captureCurrentCoords();
    expect(result).toEqual({
      ok: true,
      coords: { latitude: 37.7749, longitude: -122.4194 },
    });
  });

  it("returns services_off when Location Services disabled at the OS level", async () => {
    mocks.hasServicesEnabledAsync.mockResolvedValue(false);

    const result = await captureCurrentCoords();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("services_off");
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("returns denied when foreground permission rejected", async () => {
    mocks.hasServicesEnabledAsync.mockResolvedValue(true);
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    const result = await captureCurrentCoords();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("denied");
    expect(mocks.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("returns error and reports to Sentry when getCurrentPositionAsync throws", async () => {
    mocks.hasServicesEnabledAsync.mockResolvedValue(true);
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
    mocks.getCurrentPositionAsync.mockRejectedValue(new Error("GPS unavailable"));

    const result = await captureCurrentCoords();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).toContain("GPS unavailable");
    }
  });
});
