"use client";

import type { ErrorEventInput, ErrorEnv } from "@/lib/schemas/errors";
import { trackOpsEvent } from "@/lib/analytics/events";

// Configuration
const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 1000; // Debounce delay before flushing
const MAX_QUEUE_SIZE = 100; // Prevent memory issues
const INGEST_ENDPOINT = "/api/errors/ingest";
const MAX_BREADCRUMBS = 20;
const DEBOUNCE_WINDOW_MS = 60_000; // 60 seconds - skip duplicate errors

// Module state
let errorQueue: ErrorEventInput[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let isInitialized = false;
let userId: string | undefined;

// Breadcrumb tracking
type BreadcrumbType = "navigation" | "network" | "click" | "console" | "error";
interface Breadcrumb {
  type: BreadcrumbType;
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
}
const breadcrumbs: Breadcrumb[] = [];

// Debouncing state - track recent errors to avoid duplicates
const recentErrors = new Map<string, number>(); // fingerprint -> timestamp

type ClientErrorEvent = {
  name?: string;
  message: string;
  stack?: string;
  route?: string;
  severity?: "low" | "medium" | "high" | "critical";
  meta?: Record<string, unknown>;
};

/**
 * Add a breadcrumb for context tracking.
 */
function addBreadcrumb(type: BreadcrumbType, message: string, data?: Record<string, unknown>): void {
  const crumb: Breadcrumb = {
    type,
    timestamp: Date.now(),
    message: message.slice(0, 500),
    data,
  };

  breadcrumbs.push(crumb);

  // Keep only the last MAX_BREADCRUMBS
  while (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

/**
 * Generate quick fingerprint for debouncing duplicate errors.
 */
function quickFingerprint(name: string, message: string, stack?: string): string {
  const normalizedName = name || "Error";
  const normalizedMessage = (message || "").slice(0, 100);

  // Extract first meaningful stack frame
  let firstFrame = "";
  if (stack) {
    const lines = stack.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("at ") && !trimmed.includes("node_modules")) {
        firstFrame = trimmed.slice(0, 200);
        break;
      }
    }
  }

  return `${normalizedName}|${normalizedMessage}|${firstFrame}`;
}

/**
 * Check if an error should be debounced (seen recently).
 */
function shouldDebounce(fingerprint: string): boolean {
  const now = Date.now();
  const lastSeen = recentErrors.get(fingerprint);

  if (lastSeen && now - lastSeen < DEBOUNCE_WINDOW_MS) {
    return true;
  }

  // Clean up old entries
  for (const [fp, ts] of recentErrors) {
    if (now - ts > DEBOUNCE_WINDOW_MS) {
      recentErrors.delete(fp);
    }
  }

  recentErrors.set(fingerprint, now);
  return false;
}

/**
 * Setup navigation breadcrumb tracking via history API.
 */
function setupNavigationTracking(): void {
  // Track initial page
  addBreadcrumb("navigation", `Page load: ${getCurrentRoute()}`);

  // Intercept pushState
  const originalPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    const result = originalPushState(...args);
    addBreadcrumb("navigation", `Navigate to: ${getCurrentRoute()}`);
    return result;
  };

  // Intercept replaceState
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    const result = originalReplaceState(...args);
    addBreadcrumb("navigation", `Replace state: ${getCurrentRoute()}`);
    return result;
  };

  // Track popstate (back/forward navigation)
  window.addEventListener("popstate", () => {
    addBreadcrumb("navigation", `Back/forward to: ${getCurrentRoute()}`);
  });
}

/**
 * Setup fetch interception for network breadcrumbs.
 */
function setupNetworkTracking(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const startTime = Date.now();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || "GET";

    // Skip error/telemetry/analytics endpoints to avoid recursion
    if (url.includes("/api/errors/") || url.includes("/api/telemetry/") || url.includes("/api/analytics/")) {
      return originalFetch(input, init);
    }

    try {
      const response = await originalFetch(input, init);
      const duration = Date.now() - startTime;

      addBreadcrumb("network", `${method} ${url}`, {
        status: response.status,
        duration,
      });

      if (!response.ok) {
        trackOpsEvent("api_error", {
          endpoint_group: classifyEndpointGroup(url),
          http_status: response.status,
          error_code: response.statusText || "http_error",
          retryable: response.status >= 500,
        });
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      addBreadcrumb("network", `${method} ${url} (failed)`, {
        error: error instanceof Error ? error.message : "Unknown error",
        duration,
      });

      trackOpsEvent("api_error", {
        endpoint_group: classifyEndpointGroup(url),
        http_status: 0,
        error_code: "network_error",
        retryable: true,
      });

      throw error;
    }
  };
}

function classifyEndpointGroup(url: string): "auth" | "directory" | "events" | "forms" | "chat" | "donations" | "schedule" | "admin" {
  if (url.includes("/api/auth")) return "auth";
  if (url.includes("/api/organizations") || url.includes("/api/members") || url.includes("/api/alumni")) return "directory";
  if (url.includes("/api/events") || url.includes("/api/notifications")) return "events";
  if (url.includes("/api/forms") || url.includes("/api/documents")) return "forms";
  if (url.includes("/api/chat")) return "chat";
  if (url.includes("/api/stripe") || url.includes("/api/donations")) return "donations";
  if (url.includes("/api/calendar") || url.includes("/api/schedules")) return "schedule";
  return "admin";
}

/**
 * Initialize client-side error capture.
 * Sets up global error handlers for unhandled errors and promise rejections.
 */
export function initErrorCapture(): void {
  if (typeof window === "undefined" || isInitialized) {
    return;
  }

  isInitialized = true;

  // Setup breadcrumb tracking
  setupNavigationTracking();
  setupNetworkTracking();

  // Handle uncaught errors
  window.addEventListener("error", (event) => {
    captureClientError({
      name: event.error?.name || "Error",
      message: event.message || "Unknown error",
      stack: event.error?.stack,
      meta: {
        source: "window.onerror",
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // Handle unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      captureClientError({
        name: reason.name,
        message: reason.message,
        stack: reason.stack,
        meta: { source: "unhandledrejection" },
      });
    } else {
      captureClientError({
        name: "UnhandledPromiseRejection",
        message: String(reason),
        meta: { source: "unhandledrejection" },
      });
    }
  });

  // Flush queue before page unload
  window.addEventListener("beforeunload", () => {
    flushSync();
  });

  // Also flush on visibility change (tab hidden)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushSync();
    }
  });
}

/**
 * Set the current user ID for error attribution.
 */
export function setUserId(id: string | undefined): void {
  userId = id;
}

/**
 * Get collected breadcrumbs (copy).
 */
function getBreadcrumbs(): Breadcrumb[] {
  return [...breadcrumbs];
}

/**
 * Collect client metadata.
 */
function collectClientMeta(): Record<string, unknown> {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const win = typeof window !== "undefined" ? window : null;

  const meta: Record<string, unknown> = {
    userAgent: nav?.userAgent ?? "",
    language: nav?.language ?? "",
    cookiesEnabled: nav?.cookieEnabled ?? false,
    viewport: {
      width: win?.innerWidth ?? 0,
      height: win?.innerHeight ?? 0,
      devicePixelRatio: win?.devicePixelRatio ?? 1,
    },
    url: win?.location.href ?? "",
    referrer: document?.referrer || undefined,
  };

  // Navigator.connection (experimental API)
  const connection = (nav as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } })?.connection;
  if (connection) {
    meta.connection = {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
    };
  }

  // Performance.memory (Chrome only)
  const perf = typeof performance !== "undefined" ? performance : null;
  const memory = (perf as Performance & { memory?: { jsHeapSizeLimit: number; totalJSHeapSize: number; usedJSHeapSize: number } })?.memory;
  if (memory) {
    meta.memory = {
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      totalJSHeapSize: memory.totalJSHeapSize,
      usedJSHeapSize: memory.usedJSHeapSize,
    };
  }

  return meta;
}

/**
 * Capture a client-side error.
 * Errors are batched and sent to the server in groups.
 */
export function captureClientError(event: ClientErrorEvent): void {
  if (typeof window === "undefined") {
    return;
  }

  // Check debouncing - skip if we've seen this error recently
  const fingerprint = quickFingerprint(event.name || "Error", event.message, event.stack);
  if (shouldDebounce(fingerprint)) {
    return;
  }

  // Add error breadcrumb
  addBreadcrumb("error", `${event.name || "Error"}: ${event.message}`);

  // Collect client metadata and breadcrumbs
  const clientMeta = collectClientMeta();

  // Build the error event
  const errorEvent: ErrorEventInput = {
    name: event.name,
    message: event.message,
    stack: event.stack?.slice(0, 10000),
    route: getCurrentRoute(),
    severity: event.severity,
    meta: {
      ...event.meta,
      ...clientMeta,
      userId: userId || undefined,
      breadcrumbs: getBreadcrumbs(),
    },
  };

  // Add to queue
  errorQueue.push(errorEvent);

  // Emit ops analytics event without user identifiers
  trackOpsEvent("client_error", {
    error_code: event.name || "ClientError",
  });

  // Prevent queue from growing too large
  if (errorQueue.length > MAX_QUEUE_SIZE) {
    errorQueue = errorQueue.slice(-MAX_QUEUE_SIZE);
  }

  // Schedule flush
  scheduleFlush();
}

/**
 * Capture a React error boundary error.
 */
export function captureReactError(
  error: Error,
  errorInfo: { componentStack?: string }
): void {
  captureClientError({
    name: error.name,
    message: error.message,
    stack: error.stack,
    severity: "high",
    meta: {
      type: "react_error_boundary",
      componentStack: errorInfo.componentStack?.slice(0, 5000),
    },
  });
}

function getCurrentRoute(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.pathname;
}

function getEnv(): ErrorEnv {
  // Check for Vercel environment
  if (typeof process !== "undefined") {
    if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") {
      return "production";
    }
    if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview") {
      return "staging";
    }
  }

  // Fallback based on hostname
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "development";
    }
    if (hostname.includes("preview") || hostname.includes("staging")) {
      return "staging";
    }
  }

  return "production";
}

function scheduleFlush(): void {
  if (flushTimeout) {
    return; // Already scheduled
  }

  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flush();
  }, FLUSH_DELAY_MS);
}

async function flush(): Promise<void> {
  if (errorQueue.length === 0) {
    return;
  }

  // Take up to MAX_BATCH_SIZE errors
  const batch = errorQueue.splice(0, MAX_BATCH_SIZE);
  const sessionId = getSessionId();
  const env = getEnv();

  try {
    const response = await fetch(INGEST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: batch,
        sessionId,
        env,
      }),
      // Don't fail silently but also don't block the page
      keepalive: true,
    });

    if (!response.ok) {
      // Put errors back in queue for retry (at the front)
      errorQueue.unshift(...batch);
      console.error("[error-capture] Failed to send errors:", response.status);
    }
  } catch (err) {
    // Network error - put errors back in queue
    errorQueue.unshift(...batch);
    console.error("[error-capture] Network error:", err);
  }

  // If there are more errors in the queue, schedule another flush
  if (errorQueue.length > 0) {
    scheduleFlush();
  }
}

/**
 * Synchronously flush the error queue (for beforeunload).
 * Uses sendBeacon for reliability.
 */
function flushSync(): void {
  if (errorQueue.length === 0) {
    return;
  }

  const batch = errorQueue.splice(0, MAX_BATCH_SIZE);
  const sessionId = getSessionId();
  const env = getEnv();

  try {
    const payload = JSON.stringify({
      events: batch,
      sessionId,
      env,
    });

    // Use sendBeacon for reliable delivery during page unload
    const sent = navigator.sendBeacon(INGEST_ENDPOINT, payload);

    if (!sent) {
      // Fallback to sync XHR (not recommended but better than nothing)
      console.warn("[error-capture] sendBeacon failed, errors may be lost");
    }
  } catch (err) {
    console.error("[error-capture] Flush sync failed:", err);
  }
}
