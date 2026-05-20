import {
    CaptchaConfig,
    CaptchaProvider,
    CaptchaVerifyResult,
} from "./provider";
import { verifyTurnstile } from "./turnstile";

export type { CaptchaConfig, CaptchaProvider, CaptchaVerifyResult };

export function getCaptchaSiteKey(): string {
    return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
}

export async function verifyCaptcha(
    token: string,
    remoteIp?: string,
    config?: CaptchaConfig,
): Promise<CaptchaVerifyResult> {
    return verifyTurnstile(token, remoteIp, config);
}
