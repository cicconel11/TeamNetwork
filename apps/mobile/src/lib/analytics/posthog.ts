/**
 * PostHog client wrapper for first-party product analytics.
 *
 * NON-TRACKING GUARANTEE (Apple App Store nutrition label).
 * Apple defines "tracking" as linking user/device data with third-party data
 * for ads, or sharing it with a data broker. This integration does NOT track:
 *   - No advertising identifier (IDFA): `expo-tracking-transparency` is not a
 *     dependency, so the IDFA is never read. PostHog uses a random
 *     per-install UUID as the distinct_id, not a cross-app identifier.
 *   - No session replay (`enableSessionReplay: false`).
 *   - First-party only: events go to our own PostHog instance; not shared
 *     with ad networks or data brokers.
 * These options are pinned explicitly so the config cannot silently drift into
 * tracking behaviour that would falsify the "Data Not Used to Track You"
 * declaration in docs/app-store-submission.md. Do not enable IDFA collection,
 * session replay, or ad-network integrations without updating that label first.
 */

import PostHog from "posthog-react-native";

let client: PostHog | null = null;

export function init(apiKey: string): void {
  if (client) return;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  client = new PostHog(apiKey, {
    host,
    // First-party persistence on-device; no cross-app identifier.
    persistence: "file",
    // Session replay records the screen — keep off to stay non-tracking.
    enableSessionReplay: false,
  });
}

export function identify(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, any>
): void {
  client?.identify(userId, properties);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setUserProperties(properties: Record<string, any>): void {
  client?.capture("$set", { $set: properties });
}

export function screen(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, any>
): void {
  client?.screen(name, properties);
}

export function track(
  event: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, any>
): void {
  client?.capture(event, properties);
}

export function reset(): void {
  client?.reset();
}

export function isInitialized(): boolean {
  return client !== null;
}
