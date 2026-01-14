export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  // Always trim to prevent trailing whitespace/newlines from breaking API keys
  return value.trim();
}

/**
 * Checks if hCaptcha is properly configured
 * Returns true if the secret key is set, false otherwise
 */
export function isCaptchaConfigured(): boolean {
  const secretKey = process.env.HCAPTCHA_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  return !!(secretKey && secretKey.trim() !== "" && siteKey && siteKey.trim() !== "");
}

/**
 * Validates hCaptcha environment configuration
 * - In production: throws error if HCAPTCHA_SECRET_KEY is missing
 * - In development: logs warning if keys are missing
 * 
 * Call this during app initialization to catch configuration issues early
 */
export function validateCaptchaEnv(): void {
  const secretKey = process.env.HCAPTCHA_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  const isProduction = process.env.NODE_ENV === "production";

  const missingSecretKey = !secretKey || secretKey.trim() === "";
  const missingSiteKey = !siteKey || siteKey.trim() === "";

  if (isProduction) {
    if (missingSecretKey) {
      throw new Error(
        "Missing required environment variable: HCAPTCHA_SECRET_KEY. " +
        "hCaptcha protection is required in production."
      );
    }
    if (missingSiteKey) {
      throw new Error(
        "Missing required environment variable: NEXT_PUBLIC_HCAPTCHA_SITE_KEY. " +
        "hCaptcha protection is required in production."
      );
    }
  } else {
    // Development mode - log warnings
    if (missingSecretKey || missingSiteKey) {
      const missing: string[] = [];
      if (missingSecretKey) missing.push("HCAPTCHA_SECRET_KEY");
      if (missingSiteKey) missing.push("NEXT_PUBLIC_HCAPTCHA_SITE_KEY");

      console.warn(
        `[env] hCaptcha keys not configured: ${missing.join(", ")}. ` +
        "Captcha verification will be bypassed in development mode."
      );
    }
  }
}

/**
 * Validates AUTH_TEST_MODE is never enabled in production.
 * Throws error if test mode is enabled in production environment.
 */
export function validateAuthTestMode(): void {
  const isTestMode = process.env.AUTH_TEST_MODE === "true";
  const isProduction = process.env.NODE_ENV === "production";

  if (isTestMode && isProduction) {
    throw new Error(
      "SECURITY ERROR: AUTH_TEST_MODE cannot be enabled in production. " +
      "This would bypass all authentication and allow unauthorized access."
    );
  }

  if (isTestMode) {
    console.warn(
      "[SECURITY WARNING] AUTH_TEST_MODE is enabled. " +
      "All JWT validation is bypassed. This should only be used in local testing."
    );
  }
}

/**
 * Hashes sensitive values for logging.
 * Uses simple string manipulation to create a deterministic hash that works in Edge runtime.
 * Returns a short hash string.
 */
export function hashForLogging(value: string | null | undefined): string {
  if (!value) return "null";
  // Simple deterministic hash compatible with Edge runtime (no crypto import)
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Determines if verbose auth logging is enabled.
 * Only enabled in development or when explicitly requested.
 */
export function shouldLogAuth(): boolean {
  if (process.env.NODE_ENV === "production") {
    return process.env.LOG_AUTH_VERBOSE === "true";
  }
  return process.env.NEXT_PUBLIC_LOG_AUTH !== "false";
}

/**
 * Determines if auth failures should be logged.
 * Always log failures for debugging, even in production.
 */
export function shouldLogAuthFailures(): boolean {
  return process.env.LOG_AUTH_FAILURES !== "false";
}










