"use client";

import { forwardRef } from "react";
import { TurnstileWidget, type TurnstileWidgetRef } from "./TurnstileWidget";

export type CaptchaProvider = "turnstile";

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

export type CaptchaRef = TurnstileWidgetRef;

export const Captcha = forwardRef<CaptchaRef, CaptchaProps>((props, ref) => {
  const rest: CaptchaProps = { ...props };
  delete rest.provider;
  return <TurnstileWidget ref={ref} {...rest} />;
});

Captcha.displayName = "Captcha";
