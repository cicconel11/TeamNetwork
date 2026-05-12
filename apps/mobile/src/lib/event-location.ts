import * as Location from "expo-location";
import * as sentry from "@/lib/analytics/sentry";

export type Coords = { latitude: number; longitude: number };

export type CaptureResult =
  | { ok: true; coords: Coords }
  | { ok: false; reason: "denied" | "services_off" | "timeout" | "error"; message: string };

/**
 * Request foreground location permission and read the device's current
 * position. Used for two flows:
 *   1. Event creation — the organizer stamps the event with their current
 *      lat/lng so members can geofence-verify check-ins.
 *   2. Self check-in — the user proves they're at the venue.
 *
 * Returns a discriminated union so callers can show specific UI per failure.
 * Permission denial is NOT treated as an error to surface to Sentry — it's
 * a user choice.
 */
export async function captureCurrentCoords(): Promise<CaptureResult> {
  try {
    const servicesOn = await Location.hasServicesEnabledAsync();
    if (!servicesOn) {
      return { ok: false, reason: "services_off", message: "Turn on Location Services in iOS Settings." };
    }
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      return { ok: false, reason: "denied", message: "Location permission was denied." };
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      ok: true,
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
    };
  } catch (err) {
    sentry.captureException(err as Error, { context: "captureCurrentCoords" });
    return {
      ok: false,
      reason: "error",
      message: (err as Error).message ?? "Couldn't read location.",
    };
  }
}
