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
import {
  canTrackBehavioralEvent,
  type TrackingLevel,
} from "./policy";

// User opt-in preference (defaults to on outside dev).
let enabledPref = !__DEV__;
// Minor-aware tracking level (Apple 5.1.4). "none" disables all third-party
// analytics; "page_view_only" allows screen views but no behavioral events.
let trackingLevel: TrackingLevel = "full";
// Effective gate: analytics run only when the user opts in AND the resolved
// tracking level permits any analytics at all. Recomputed by
// applyEffectiveEnabled() whenever the preference or level changes; the initial
// value equals the preference because the default level ("full") never forces
// analytics off.
let enabled = enabledPref;
let configStored: AnalyticsConfig | null = null;
let sdksInitialized = false;
const eventQueue: QueuedEvent[] = [];
const MAX_QUEUE_SIZE = 100;
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
  sentry.setEnabled(true);
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
  sentry.setEnabled(enabled);

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
    if (eventQueue.length < MAX_QUEUE_SIZE) {
      eventQueue.push({ type: "identify", userId, traits });
    } else {
      console.warn(`[Analytics] Event queue full (${MAX_QUEUE_SIZE}), dropping identify event`);
    }
    return;
  }

  posthog.identify(userId, traits);
  sentry.setUser({ id: userId });
}

/**
 * Set or update user properties. Queued if called before SDKs init.
 */
export function setUserProperties(properties: UserProperties): void {
  if (!enabled || !canTrackBehavioralEvent(trackingLevel)) return;

  if (!sdksInitialized) {
    if (eventQueue.length < MAX_QUEUE_SIZE) {
      eventQueue.push({ type: "setUserProperties", properties });
    } else {
      console.warn(`[Analytics] Event queue full (${MAX_QUEUE_SIZE}), dropping setUserProperties event`);
    }
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
    if (eventQueue.length < MAX_QUEUE_SIZE) {
      eventQueue.push({ type: "screen", name, properties });
    } else {
      console.warn(`[Analytics] Event queue full (${MAX_QUEUE_SIZE}), dropping screen event`);
    }
    return;
  }

  posthog.screen(name, properties);
}

/**
 * Track a custom event. Queued if called before SDKs init.
 */
export function track(event: string, properties?: EventProperties): void {
  if (!enabled || !canTrackBehavioralEvent(trackingLevel)) return;

  if (!sdksInitialized) {
    if (eventQueue.length < MAX_QUEUE_SIZE) {
      eventQueue.push({ type: "track", event, properties });
    } else {
      console.warn(`[Analytics] Event queue full (${MAX_QUEUE_SIZE}), dropping track event`);
    }
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
 * Recompute the effective `enabled` gate from the opt-in preference and the
 * minor-aware tracking level, applying the SDK transition (init when turning
 * on, reset when turning off). Single source of truth so `setEnabled` and
 * `setTrackingLevel` cannot drift.
 */
function applyEffectiveEnabled(): void {
  const wasEnabled = enabled;
  enabled = enabledPref && trackingLevel !== "none";
  sentry.setEnabled(enabled);

  if (!enabled && wasEnabled) {
    reset();
  }
  if (enabled && !wasEnabled) {
    initSdksIfNeeded();
  }
}

/**
 * Enable or disable analytics (user opt-in). The effective state also depends
 * on the minor-aware tracking level — a minor at level "none" stays off even
 * when the preference is on.
 */
export function setEnabled(value: boolean): void {
  enabledPref = value;
  applyEffectiveEnabled();
  void persistEnabled(value);
}

/**
 * Set the minor-aware tracking level (Apple 5.1.4). "none" turns analytics off
 * entirely (under_13); "page_view_only" keeps screen views but drops behavioral
 * events (13_17); "full" is unrestricted (18_plus). Call before/at identify
 * once the user's age bracket is known.
 */
export function setTrackingLevel(level: TrackingLevel): void {
  if (level === trackingLevel) return;
  trackingLevel = level;
  applyEffectiveEnabled();
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

export function captureException(
  ...args: Parameters<typeof sentry.captureException>
): void {
  if (!enabled || !sdksInitialized) return;
  sentry.captureException(...args);
}

export function captureMessage(
  ...args: Parameters<typeof sentry.captureMessage>
): void {
  if (!enabled || !sdksInitialized) return;
  sentry.captureMessage(...args);
}
