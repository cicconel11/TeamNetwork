export type CaptchaProvider = "hcaptcha" | "turnstile";

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
    provider?: CaptchaProvider;
}

export const DEFAULT_CAPTCHA_TIMEOUT_MS = 3000;
