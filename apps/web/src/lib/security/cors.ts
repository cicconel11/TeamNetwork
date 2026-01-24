/**
 * Centralized CORS configuration
 *
 * This module provides consistent CORS headers across all API routes.
 * In production, it uses an explicit allowlist from CORS_ALLOWED_ORIGINS.
 * In development, it allows all origins only if no explicit config is set.
 */

type CorsHeaders = {
  "Access-Control-Allow-Origin": string;
  "Access-Control-Allow-Methods"?: string;
  "Access-Control-Allow-Headers"?: string;
};

/**
 * Get CORS headers for API responses.
 *
 * @param options.includeAllMethods - Include Allow-Methods and Allow-Headers for preflight
 * @returns CORS headers object
 *
 * Configuration:
 * - CORS_ALLOWED_ORIGINS: Comma-separated list of allowed origins (e.g., "https://www.myteamnetwork.com,https://app.myteamnetwork.com")
 * - In production: requires CORS_ALLOWED_ORIGINS or returns empty origin (blocks cross-origin)
 * - In development: allows "*" only if CORS_ALLOWED_ORIGINS is not set
 */
export function getCorsHeaders(options?: { includeAllMethods?: boolean }): CorsHeaders {
  const isProduction = process.env.NODE_ENV === "production";
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.trim();

  let origin: string;

  if (allowedOrigins) {
    // If explicit origins are configured, use the first one for simple requests.
    // For full CORS support with multiple origins, check the request Origin header
    // and return that specific origin if it's in the allowlist.
    const origins = allowedOrigins.split(",").map((o) => o.trim());
    origin = origins[0] || "";
  } else if (isProduction) {
    // Production without explicit config: block cross-origin requests
    origin = "";
  } else {
    // Development without explicit config: allow all origins
    origin = "*";
  }

  const headers: CorsHeaders = {
    "Access-Control-Allow-Origin": origin,
  };

  if (options?.includeAllMethods) {
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  }

  return headers;
}

/**
 * Get CORS headers for a specific request, checking if the Origin is in the allowlist.
 * Use this for routes that need to support multiple specific origins.
 *
 * @param requestOrigin - The Origin header from the incoming request
 * @param options.includeAllMethods - Include Allow-Methods and Allow-Headers for preflight
 * @returns CORS headers object
 */
export function getCorsHeadersForOrigin(
  requestOrigin: string | null,
  options?: { includeAllMethods?: boolean }
): CorsHeaders {
  const isProduction = process.env.NODE_ENV === "production";
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.trim();

  let origin: string;

  if (allowedOrigins) {
    const origins = allowedOrigins.split(",").map((o) => o.trim());
    // Check if the request origin is in our allowlist
    if (requestOrigin && origins.includes(requestOrigin)) {
      origin = requestOrigin;
    } else {
      // Origin not in allowlist - block by returning empty
      origin = "";
    }
  } else if (isProduction) {
    // Production without explicit config: block cross-origin requests
    origin = "";
  } else {
    // Development without explicit config: allow all origins
    origin = "*";
  }

  const headers: CorsHeaders = {
    "Access-Control-Allow-Origin": origin,
  };

  if (options?.includeAllMethods) {
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  }

  return headers;
}
