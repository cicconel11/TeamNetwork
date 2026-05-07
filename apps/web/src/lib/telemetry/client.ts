"use client";

/**
 * Client-side telemetry module.
 *
 * This module provides a thin wrapper around the main error capture system
 * in src/lib/errors/client.ts. For most use cases, import from @/lib/errors/client directly.
 *
 * This module is kept for backward compatibility with the telemetry API endpoint.
 */

export {
  initErrorCapture as initTelemetry,
  captureClientError as captureError,
  setUserId,
} from "@/lib/errors/client";

import type { BreadcrumbType } from "./types";

/**
 * Record a manual breadcrumb.
 * @deprecated Breadcrumbs are now tracked automatically by @/lib/errors/client.
 * This function is kept for API compatibility but does nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function recordBreadcrumb(type: BreadcrumbType, message: string, data?: Record<string, unknown>): void {
  // No-op - breadcrumbs are managed internally by @/lib/errors/client
}
