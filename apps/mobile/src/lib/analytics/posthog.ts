/**
 * PostHog client wrapper for product analytics
 */

import PostHog from "posthog-react-native";

let client: PostHog | null = null;

export function init(apiKey: string): void {
  if (client) return;
  client = new PostHog(apiKey, { host: "https://us.i.posthog.com" });
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
