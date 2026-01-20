/**
 * Analytics abstraction layer
 *
 * Provides a unified API for PostHog (product analytics) and Sentry (error tracking).
 * Buffers events before initialization and supports enable/disable for privacy.
 */

import type {
  AnalyticsConfig,
  EventProperties,
  QueuedEvent,
  ScreenProperties,
  UserProperties,
  UserTraits,
} from "./types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as posthog from "./posthog";
import * as sentry from "./sentry";

let enabled = !__DEV__;
let configStored: AnalyticsConfig | null = null;
let sdksInitialized = false;
const eventQueue: QueuedEvent[] = [];
const ENABLED_STORAGE_KEY = "analytics.enabled";

async function persistEnabled(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ENABLED_STORAGE_KEY, value ? "true" : "false");
  } catch (error) {
    console.warn("[Analytics] Failed to persist enabled state.", error);
  }
}

/**
 * Load persisted enabled state. Defaults are applied when no value exists.
 */
export async function hydrateEnabled(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(ENABLED_STORAGE_KEY);
    if (stored === null) return;

    const persistedValue = stored === "true";
    if (persistedValue !== enabled) {
      setEnabled(persistedValue);
    }
  } catch (error) {
    console.warn("[Analytics] Failed to load enabled state.", error);
  }
}

/**
 * Check if config has valid keys (non-empty strings).
 */
function hasValidConfig(config: AnalyticsConfig | null): config is AnalyticsConfig {
  return !!(config?.posthogKey && config?.sentryDsn);
}

/**
 * Initialize the underlying SDKs if enabled and config is valid.
 */
function initSdksIfNeeded(): void {
  if (sdksInitialized || !enabled || !hasValidConfig(configStored)) {
    return;
  }

  posthog.init(configStored.posthogKey);
  sentry.init(configStored.sentryDsn);
  sdksInitialized = true;
  flushQueue();
}

/**
 * Initialize analytics services. Stores config for lazy initialization.
 * SDKs are only initialized when enabled and config is valid.
 */
export function init(config: AnalyticsConfig): void {
  // Store config for potential later use (e.g., setEnabled(true) after init)
  configStored = config;

  // Warn in production if config is missing
  if (!hasValidConfig(config) && !__DEV__) {
    console.warn(
      "[Analytics] Missing EXPO_PUBLIC_POSTHOG_KEY or EXPO_PUBLIC_SENTRY_DSN. Analytics disabled."
    );
  }

  initSdksIfNeeded();
}

/**
 * Identify the current user. Queued if called before SDKs init.
 */
export function identify(userId: string, traits?: UserTraits): void {
  if (!enabled) return;

  if (!sdksInitialized) {
    eventQueue.push({ type: "identify", userId, traits });
    return;
  }

  posthog.identify(userId, traits);
  sentry.setUser({ id: userId, email: traits?.email as string | undefined });
}

/**
 * Set or update user properties. Queued if called before SDKs init.
 */
export function setUserProperties(properties: UserProperties): void {
  if (!enabled) return;

  if (!sdksInitialized) {
    eventQueue.push({ type: "setUserProperties", properties });
    return;
  }

  posthog.setUserProperties(properties);
}

/**
 * Track a screen view. Queued if called before SDKs init.
 */
export function screen(name: string, properties?: ScreenProperties): void {
  if (!enabled) return;

  if (!sdksInitialized) {
    eventQueue.push({ type: "screen", name, properties });
    return;
  }

  posthog.screen(name, properties);
}

/**
 * Track a custom event. Queued if called before SDKs init.
 */
export function track(event: string, properties?: EventProperties): void {
  if (!enabled) return;

  if (!sdksInitialized) {
    eventQueue.push({ type: "track", event, properties });
    return;
  }

  posthog.track(event, properties);
}

/**
 * Reset user identity. Clears queue and context even when disabled.
 */
export function reset(): void {
  eventQueue.length = 0;

  if (sdksInitialized) {
    posthog.reset();
    sentry.setUser(null);
  }
}

/**
 * Enable or disable analytics. When enabling, initializes SDKs if config is available.
 */
export function setEnabled(value: boolean): void {
  const wasEnabled = enabled;
  enabled = value;

  if (!value && wasEnabled) {
    reset();
  }

  // If enabling and we have stored config, try to initialize SDKs
  if (value && !wasEnabled) {
    initSdksIfNeeded();
  }

  void persistEnabled(value);
}

/**
 * Check if analytics is currently enabled.
 */
export function isEnabled(): boolean {
  return enabled;
}

/**
 * Flush queued events after SDK initialization.
 */
function flushQueue(): void {
  if (!enabled || !sdksInitialized) {
    return;
  }

  while (eventQueue.length > 0) {
    const event = eventQueue.shift();
    if (!event) continue;

    switch (event.type) {
      case "identify":
        identify(event.userId, event.traits);
        break;
      case "setUserProperties":
        setUserProperties(event.properties);
        break;
      case "screen":
        screen(event.name, event.properties);
        break;
      case "track":
        track(event.event, event.properties);
        break;
    }
  }
}

// Re-export Sentry functions for direct error tracking
export { captureException, captureMessage } from "./sentry";
