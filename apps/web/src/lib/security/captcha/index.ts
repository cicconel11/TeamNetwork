import {
    CaptchaConfig,
    CaptchaProvider,
    CaptchaVerifyResult,
} from "./provider";
import { verifyHCaptcha } from "./hcaptcha";
import { verifyTurnstile } from "./turnstile";

export type { CaptchaConfig, CaptchaProvider, CaptchaVerifyResult };

function resolveProvider(override?: CaptchaProvider): CaptchaProvider {
    if (override) return override;
    return process.env.CAPTCHA_PROVIDER === "hcaptcha" ? "hcaptcha" : "turnstile";
}

export function getCaptchaSiteKey(): string {
    const provider = resolveProvider();
    return provider === "turnstile"
        ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ""
        : process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";
}

export async function verifyCaptcha(
    token: string,
    remoteIp?: string,
    config?: CaptchaConfig,
): Promise<CaptchaVerifyResult> {
    const provider = resolveProvider(config?.provider);
    return provider === "turnstile"
        ? verifyTurnstile(token, remoteIp, config)
        : verifyHCaptcha(token, remoteIp, config);
}
