export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  // Always trim to prevent trailing whitespace/newlines from breaking API keys
  return value.trim();
}

/**
 * Like `requireEnv`, but returns `dummy` when `SKIP_STRIPE_VALIDATION=true`.
 *
 * Use this only at module-load-time in Stripe integration code, so that
 * `next build` can do its "Collect page data" pass in CI without real Stripe
 * credentials. The flag is only ever set in local dev and CI — never in
 * production — so the fallback branch is unreachable at runtime in prod.
 *
 * See `.github/workflows/ci.yml` and `next.config.mjs`'s `validateBuildEnv()`
 * for the other half of the skip-Stripe-in-CI story.
 */
export function requireEnvOrDummy(name: string, dummy: string): string {
  if (process.env.SKIP_STRIPE_VALIDATION === "true") {
    const value = process.env[name];
    return value && value.trim() !== "" ? value.trim() : dummy;
  }
  return requireEnv(name);
}

type CaptchaProvider = "hcaptcha" | "turnstile";

function resolveDefaultProvider(): CaptchaProvider {
  return process.env.CAPTCHA_PROVIDER === "turnstile" ? "turnstile" : "hcaptcha";
}

function hasValue(v: string | undefined): boolean {
  return !!(v && v.trim() !== "");
}

/**
 * Checks if the captcha provider is configured (server secret + public site key).
 * Defaults to the provider selected by CAPTCHA_PROVIDER.
 */
export function isCaptchaConfigured(provider?: CaptchaProvider): boolean {
  const target = provider ?? resolveDefaultProvider();
  if (target === "turnstile") {
    return hasValue(process.env.TURNSTILE_SECRET_KEY) && hasValue(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  }
  return hasValue(process.env.HCAPTCHA_SECRET_KEY) && hasValue(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY);
}

/**
 * Validates captcha environment configuration.
 * - hCaptcha pair always required in prod (auth flows still use it).
 * - If CAPTCHA_PROVIDER=turnstile, Turnstile pair also required.
 * - Warns on client/server provider mismatch.
 * - Dev: warns only.
 */
export function validateCaptchaEnv(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const provider = resolveDefaultProvider();
  const clientProvider = process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER === "turnstile" ? "turnstile" : "hcaptcha";

  const missingHcaptchaSecret = !hasValue(process.env.HCAPTCHA_SECRET_KEY);
  const missingHcaptchaSite = !hasValue(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY);
  const missingTurnstileSecret = !hasValue(process.env.TURNSTILE_SECRET_KEY);
  const missingTurnstileSite = !hasValue(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

  if (isProduction) {
    if (missingHcaptchaSecret) {
      throw new Error(
        "Missing required environment variable: HCAPTCHA_SECRET_KEY. " +
        "hCaptcha protection is required in production (auth flows).",
      );
    }
    if (missingHcaptchaSite) {
      throw new Error(
        "Missing required environment variable: NEXT_PUBLIC_HCAPTCHA_SITE_KEY. " +
        "hCaptcha protection is required in production (auth flows).",
      );
    }
    if (provider === "turnstile") {
      if (missingTurnstileSecret) {
        throw new Error(
          "Missing required environment variable: TURNSTILE_SECRET_KEY. " +
          "Turnstile is selected via CAPTCHA_PROVIDER.",
        );
      }
      if (missingTurnstileSite) {
        throw new Error(
          "Missing required environment variable: NEXT_PUBLIC_TURNSTILE_SITE_KEY. " +
          "Turnstile is selected via CAPTCHA_PROVIDER.",
        );
      }
    }
    if (clientProvider !== provider) {
      console.warn(
        `[env] Captcha provider mismatch: server=${provider} client=${clientProvider}. ` +
        "Set NEXT_PUBLIC_CAPTCHA_PROVIDER to match CAPTCHA_PROVIDER.",
      );
    }
  } else {
    const missing: string[] = [];
    if (missingHcaptchaSecret) missing.push("HCAPTCHA_SECRET_KEY");
    if (missingHcaptchaSite) missing.push("NEXT_PUBLIC_HCAPTCHA_SITE_KEY");
    if (provider === "turnstile") {
      if (missingTurnstileSecret) missing.push("TURNSTILE_SECRET_KEY");
      if (missingTurnstileSite) missing.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    }
    if (missing.length > 0) {
      console.warn(
        `[env] Captcha keys not configured: ${missing.join(", ")}. ` +
        "Captcha verification will be bypassed in development mode.",
      );
    }
    if (clientProvider !== provider) {
      console.warn(
        `[env] Captcha provider mismatch: server=${provider} client=${clientProvider}.`,
      );
    }
  }
}

/**
 * Validates AUTH_TEST_MODE is never enabled in production.
 * Throws error if test mode is enabled in production environment.
 * Checks both NODE_ENV and VERCEL_ENV to catch all production scenarios.
 */
export function validateAuthTestMode(): void {
  const isTestMode = process.env.AUTH_TEST_MODE === "true";
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";

  if (isTestMode && isProduction) {
    throw new Error(
      "SECURITY ERROR: AUTH_TEST_MODE cannot be enabled in production. " +
      "This bypasses all JWT validation and authentication checks."
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










