import * as Location from "expo-location";

const TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([
    promise.finally(() => {
      if (id !== undefined) clearTimeout(id);
    }),
    timeoutPromise,
  ]);
}

export type DeviceCoords = { latitude: number; longitude: number };

/**
 * Prompts for foreground location if needed and returns current coordinates,
 * or an error message suitable for alerts/toasts.
 */
export async function getDeviceCoords(): Promise<
  | { ok: true; coords: DeviceCoords }
  | { ok: false; error: string }
> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") {
    return {
      ok: false,
      error: "Location access is needed to verify you’re at the event.",
    };
  }

  try {
    const location = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      TIMEOUT_MS,
      "Getting your location timed out — try again with a clearer GPS signal."
    );
    const { latitude, longitude } = location.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { ok: false, error: "Could not read your GPS coordinates." };
    }
    return { ok: true, coords: { latitude, longitude } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not read your location.";
    return { ok: false, error: msg };
  }
}
