"use client";

import { getSessionId } from "@/lib/session";
import type { UsageEvent, AgeBracket, OrgType } from "./types";
import { VALID_FEATURES, type ValidFeature } from "@/lib/schemas/analytics";
import { resolveTrackingLevel, type TrackingLevel } from "./consent";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 2000;
const MAX_QUEUE_SIZE = 200;
const INGEST_ENDPOINT = "/api/analytics/ingest";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let eventQueue: UsageEvent[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let isInitialized = false;

// Tracking context
let trackingLevel: TrackingLevel = "none";
let lastConsented = false;
let lastAgeBracket: AgeBracket | null = null;
let currentOrgId: string | undefined;
let currentFeature: string | undefined;
let featureEnterTime: number | undefined;

// Retry tracking — stop flushing after MAX_CONSECUTIVE_FAILURES to avoid
// hammering the server during sustained outages.
const MAX_CONSECUTIVE_FAILURES = 5;
let consecutiveFailures = 0;

// ---------------------------------------------------------------------------
// Context setters
// ---------------------------------------------------------------------------

/**
 * Update consent + restriction context.
 * Called by AnalyticsProvider when user/org context changes.
 */
export function setAnalyticsContext(
  consented: boolean,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): void {
  lastConsented = consented;
  lastAgeBracket = (ageBracket as AgeBracket) ?? null;

  const newLevel = resolveTrackingLevel(consented, ageBracket, orgType);

  // If tracking is being disabled, purge queued events and feature timers
  // to prevent stale data from being sent under a different user's session.
  if (newLevel === "none" && trackingLevel !== "none") {
    eventQueue = [];
    currentFeature = undefined;
    featureEnterTime = undefined;
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
  }

  trackingLevel = newLevel;

  // Reset failure counter when tracking is (re-)enabled so the client
  // can attempt flushing again after user re-engages.
  if (newLevel !== "none") {
    consecutiveFailures = 0;
  }
}

/**
 * Read the last consent + age bracket values passed to setAnalyticsContext.
 * Used by AnalyticsProvider to avoid stale refs when consent is toggled
 * externally (e.g. by ConsentBanner) between route changes.
 */
export function getLastConsentState(): { consented: boolean; ageBracket: AgeBracket | null } {
  return { consented: lastConsented, ageBracket: lastAgeBracket };
}

/**
 * Set the current organization context for event attribution.
 */
export function setOrgContext(orgId: string | undefined): void {
  currentOrgId = orgId;
}

// ---------------------------------------------------------------------------
// Device class
// ---------------------------------------------------------------------------

function getDeviceClass(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

// ---------------------------------------------------------------------------
// Feature extraction from pathname
// ---------------------------------------------------------------------------

const FEATURE_SET = new Set<string>(VALID_FEATURES);

/**
 * Extract a normalized feature name from a pathname.
 * E.g. "/org-slug/members/123" → "members"
 */
export function extractFeature(pathname: string): ValidFeature {
  // Strip leading slash and split
  const segments = pathname.replace(/^\//, "").split("/");

  // Org-scoped routes: /<orgSlug>/<feature>/...
  if (segments.length >= 2) {
    const candidate = segments[1];
    // /settings/navigation is its own feature — check sub-route before
    // falling through to the generic "settings" match.
    if (candidate === "settings" && segments.length >= 3 && FEATURE_SET.has(segments[2])) {
      return segments[2] as ValidFeature;
    }
    if (FEATURE_SET.has(candidate)) return candidate as ValidFeature;
    // Dashboard is the empty-href item — matches /<orgSlug> with no further segment
  }

  // Check if this is the org dashboard (exactly /<orgSlug>)
  if (segments.length === 1 && segments[0] !== "" && !["app", "auth", "settings", "privacy", "terms", "api"].includes(segments[0])) {
    return "dashboard";
  }

  // Settings pages
  if (segments.some((s) => s === "settings")) return "settings";

  return "other";
}

// ---------------------------------------------------------------------------
// Event capture
// ---------------------------------------------------------------------------

function captureEvent(event: UsageEvent): void {
  if (trackingLevel === "none") return;

  // Apply restrictions for page_view_only level
  const sanitized: UsageEvent = { ...event };
  if (trackingLevel === "page_view_only") {
    delete sanitized.duration_ms;
    sanitized.hour_of_day = 0; // zero out; won't store
    // Only allow page_view events
    if (sanitized.event_type !== "page_view") return;
  }

  sanitized._organization_id = currentOrgId;
  eventQueue.push(sanitized);

  if (eventQueue.length > MAX_QUEUE_SIZE) {
    eventQueue = eventQueue.slice(-MAX_QUEUE_SIZE);
  }

  scheduleFlush();
}

// ---------------------------------------------------------------------------
// Route change tracking
// ---------------------------------------------------------------------------

/**
 * Emit a feature_exit event for the current feature under the current org
 * context, then clear the feature timer. Call this before updating org
 * context on navigation so the exit event is attributed to the correct org.
 *
 * Safe to call when there is no active feature (no-op).
 */
export function flushFeatureExit(): void {
  if (trackingLevel === "none") return;

  if (currentFeature && featureEnterTime) {
    const duration = Date.now() - featureEnterTime;
    captureEvent({
      event_type: "feature_exit",
      feature: currentFeature,
      duration_ms: duration,
      device_class: getDeviceClass(),
      hour_of_day: new Date().getUTCHours(),
    });
    currentFeature = undefined;
    featureEnterTime = undefined;
  }
}

/**
 * Called when the user navigates to a new route.
 *
 * Callers should call flushFeatureExit() before changing org context so that
 * the exit event for the previous page is attributed to the correct org.
 * This function will still emit a feature_exit if one is pending (backwards
 * compatible), but it will use whatever org context is current at call time.
 */
export function handleRouteChange(pathname: string): void {
  if (trackingLevel === "none") return;

  const feature = extractFeature(pathname);

  // Exit previous feature (if flushFeatureExit wasn't called beforehand)
  if (currentFeature && featureEnterTime) {
    const duration = Date.now() - featureEnterTime;
    captureEvent({
      event_type: "feature_exit",
      feature: currentFeature,
      duration_ms: duration,
      device_class: getDeviceClass(),
      hour_of_day: new Date().getUTCHours(),
    });
  }

  // Enter new feature
  currentFeature = feature;
  featureEnterTime = Date.now();

  captureEvent({
    event_type: "page_view",
    feature,
    device_class: getDeviceClass(),
    hour_of_day: new Date().getUTCHours(),
  });

  captureEvent({
    event_type: "feature_enter",
    feature,
    device_class: getDeviceClass(),
    hour_of_day: new Date().getUTCHours(),
  });
}

/**
 * Track a nav click event (user clicked a sidebar/nav link).
 */
export function trackNavClick(feature: string): void {
  if (trackingLevel === "none") return;

  const normalized = FEATURE_SET.has(feature) ? (feature as ValidFeature) : "other";
  captureEvent({
    event_type: "nav_click",
    feature: normalized,
    device_class: getDeviceClass(),
    hour_of_day: new Date().getUTCHours(),
  });
}

// ---------------------------------------------------------------------------
// Batching / flush
// ---------------------------------------------------------------------------

function scheduleFlush(): void {
  if (flushTimeout) return;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flush();
  }, FLUSH_DELAY_MS);
}

async function flush(): Promise<void> {
  if (eventQueue.length === 0) return;

  const batch = eventQueue.splice(0, MAX_BATCH_SIZE);
  const sessionId = getSessionId();

  // Group by org to preserve per-event attribution
  const byOrg = new Map<string | undefined, UsageEvent[]>();
  for (const event of batch) {
    const orgId = event._organization_id;
    const group = byOrg.get(orgId) ?? [];
    group.push(event);
    byOrg.set(orgId, group);
  }

  for (const [orgId, events] of byOrg) {
    try {
      const response = await fetch(INGEST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events,
          session_id: sessionId || "unknown",
          organization_id: orgId,
        }),
        keepalive: true,
      });

      if (response.ok) {
        consecutiveFailures = 0;
      } else if (response.status === 403) {
        // Consent revoked or blocked — fully disable tracking.
        // Update lastConsented so getLastConsentState() returns false,
        // preventing route changes from re-enabling tracking.
        setAnalyticsContext(false, lastAgeBracket, null);
        eventQueue = [];
        return;
      } else if (response.status >= 500 || response.status === 429) {
        // Server error or rate limited — requeue for retry
        consecutiveFailures++;
        eventQueue.unshift(...events);
      }
      // 400, 401: drop the batch silently (bad payload or no auth)
    } catch {
      consecutiveFailures++;
      eventQueue.unshift(...events);
    }
  }

  if (eventQueue.length > 0) {
    scheduleFlush();
  }
}

function flushSync(): void {
  if (eventQueue.length === 0) return;

  const batch = eventQueue.splice(0, MAX_BATCH_SIZE);
  const sessionId = getSessionId();

  // Group by org to preserve per-event attribution
  const byOrg = new Map<string | undefined, UsageEvent[]>();
  for (const event of batch) {
    const orgId = event._organization_id;
    const group = byOrg.get(orgId) ?? [];
    group.push(event);
    byOrg.set(orgId, group);
  }

  for (const [orgId, events] of byOrg) {
    try {
      const payload = JSON.stringify({
        events,
        session_id: sessionId || "unknown",
        organization_id: orgId,
      });

      navigator.sendBeacon(INGEST_ENDPOINT, new Blob([payload], { type: "application/json" }));
    } catch {
      // Best-effort; events may be lost on unload
    }
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize analytics tracking. Should be called once from AnalyticsProvider.
 */
export function initAnalytics(): void {
  if (typeof window === "undefined" || isInitialized) return;
  isInitialized = true;

  // Flush on page unload
  window.addEventListener("beforeunload", () => flushSync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSync();
  });
}
