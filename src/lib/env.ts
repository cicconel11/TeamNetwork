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










