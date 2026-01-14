/**
 * Server-side hCaptcha verification utility
 * Validates captcha tokens against the hCaptcha siteverify API
 */

const HCAPTCHA_VERIFY_URL = "https://api.hcaptcha.com/siteverify";
const DEFAULT_TIMEOUT_MS = 3000;

export interface CaptchaVerifyResult {
    success: boolean;
    challenge_ts?: string;
    hostname?: string;
    credit?: boolean;
    error_codes?: string[];
}

export interface CaptchaConfig {
    secretKey?: string;
    timeout?: number;
    skipInDevelopment?: boolean;
}

/**
 * Verifies an hCaptcha token with the hCaptcha siteverify API
 * 
 * @param token - The captcha token from the client
 * @param remoteIp - Optional client IP address for additional validation
 * @param config - Optional configuration overrides
 * @returns Verification result with success status and error codes
 */
export async function verifyCaptcha(
    token: string,
    remoteIp?: string,
    config?: CaptchaConfig
): Promise<CaptchaVerifyResult> {
    const secretKey = config?.secretKey ?? process.env.HCAPTCHA_SECRET_KEY;
    const timeout = config?.timeout ?? DEFAULT_TIMEOUT_MS;
    const skipInDevelopment = config?.skipInDevelopment ?? true;

    // Development mode bypass
    if (skipInDevelopment && process.env.NODE_ENV === "development" && !secretKey) {
        console.warn("[captcha] Skipping verification in development mode - no secret key configured");
        return { success: true };
    }

    // Missing secret key in production
    if (!secretKey) {
        console.error("[captcha] HCAPTCHA_SECRET_KEY is not configured");
        return {
            success: false,
            error_codes: ["missing-secret-key"],
        };
    }

    // Missing token
    if (!token || token.trim() === "") {
        return {
            success: false,
            error_codes: ["missing-input-response"],
        };
    }

    // Build form data for hCaptcha API
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
        formData.append("remoteip", remoteIp);
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(HCAPTCHA_VERIFY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[captcha] hCaptcha API returned status ${response.status}`);
            return {
                success: false,
                error_codes: ["api-error"],
            };
        }

        const data = await response.json();

        // Map hCaptcha response to our interface
        return {
            success: data.success === true,
            challenge_ts: data.challenge_ts,
            hostname: data.hostname,
            credit: data.credit,
            error_codes: data["error-codes"],
        };
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
            console.error("[captcha] Verification request timed out");
            return {
                success: false,
                error_codes: ["timeout"],
            };
        }

        console.error("[captcha] Verification request failed:", error);
        return {
            success: false,
            error_codes: ["network-error"],
        };
    }
}

/**
 * Checks if captcha verification is enabled
 * Returns true if the secret key is configured or we're in development mode
 */
export function isCaptchaEnabled(): boolean {
    const secretKey = process.env.HCAPTCHA_SECRET_KEY;
    if (secretKey && secretKey.trim() !== "") {
        return true;
    }
    // In development, captcha is "enabled" but will be bypassed
    return process.env.NODE_ENV === "development";
}
