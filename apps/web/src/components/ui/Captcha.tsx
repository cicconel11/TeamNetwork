"use client";

import { forwardRef } from "react";
import { HCaptcha, type HCaptchaRef } from "./HCaptcha";
import { TurnstileWidget, type TurnstileWidgetRef } from "./TurnstileWidget";

const ENV_PROVIDER =
  process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER === "hcaptcha" ? "hcaptcha" : "turnstile";

export type CaptchaProvider = "hcaptcha" | "turnstile";

export interface CaptchaProps {
  provider?: CaptchaProvider;
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  theme?: "light" | "dark";
  size?: "normal" | "compact" | "invisible";
  className?: string;
}

export type CaptchaRef = HCaptchaRef | TurnstileWidgetRef;

export const Captcha = forwardRef<CaptchaRef, CaptchaProps>((props, ref) => {
  const provider = props.provider ?? ENV_PROVIDER;
  const rest: CaptchaProps = { ...props };
  delete rest.provider;

  if (provider === "turnstile") {
    return <TurnstileWidget ref={ref as React.Ref<TurnstileWidgetRef>} {...rest} />;
  }
  return <HCaptcha ref={ref as React.Ref<HCaptchaRef>} {...rest} />;
});

Captcha.displayName = "Captcha";
