import {
    CaptchaConfig,
    CaptchaVerifyResult,
    DEFAULT_CAPTCHA_TIMEOUT_MS,
} from "./provider";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
    token: string,
    remoteIp?: string,
    config?: CaptchaConfig,
): Promise<CaptchaVerifyResult> {
    const secretKey = config?.secretKey ?? process.env.TURNSTILE_SECRET_KEY;
    const timeout = config?.timeout ?? DEFAULT_CAPTCHA_TIMEOUT_MS;
    const skipInDevelopment = config?.skipInDevelopment ?? true;

    if (skipInDevelopment && process.env.NODE_ENV === "development" && !secretKey) {
        console.warn("[captcha] Skipping Turnstile verification in development mode - no secret key configured");
        return { success: true };
    }

    if (!secretKey) {
        console.error("[captcha] TURNSTILE_SECRET_KEY is not configured");
        return { success: false, error_codes: ["missing-secret-key"] };
    }

    if (!token || token.trim() === "") {
        return { success: false, error_codes: ["missing-input-response"] };
    }

    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) formData.append("remoteip", remoteIp);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData.toString(),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[captcha] Turnstile API returned status ${response.status}`);
            return { success: false, error_codes: ["api-error"] };
        }

        const data = await response.json();
        return {
            success: data.success === true,
            challenge_ts: data.challenge_ts,
            hostname: data.hostname,
            error_codes: data["error-codes"],
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
            console.error("[captcha] Turnstile verification request timed out");
            return { success: false, error_codes: ["timeout"] };
        }
        console.error("[captcha] Turnstile verification request failed:", error);
        return { success: false, error_codes: ["network-error"] };
    }
}
