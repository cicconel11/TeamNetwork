"use client";

import dynamic from "next/dynamic";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { TurnstileWidgetRef } from "./TurnstileWidget";

// Lazy-load the Turnstile widget so @marsidev/react-turnstile + the
// challenges.cloudflare.com script stay off the critical path.
const TurnstileWidget = dynamic(
  () => import("./TurnstileWidget").then((m) => m.TurnstileWidget),
  { ssr: false, loading: () => null },
);

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
  /** Defer mount until a short idle delay (default true). */
  defer?: boolean;
}

export type CaptchaRef = TurnstileWidgetRef;

const NOOP_REF: TurnstileWidgetRef = {
  execute: () => {},
  reset: () => {},
};

export const Captcha = forwardRef<CaptchaRef, CaptchaProps>((props, ref) => {
  const { defer = true, ...rest } = props;
  delete rest.provider;
  const innerRef = useRef<TurnstileWidgetRef | null>(null);
  const [mounted, setMounted] = useState(!defer);

  useEffect(() => {
    if (!defer) return;
    const t = setTimeout(() => setMounted(true), 200);
    return () => clearTimeout(t);
  }, [defer]);

  // Proxy ref: callers (e.g. LoginClient) invoke captchaRef.current?.reset()
  // even before the widget mounts. Return a no-op until ready.
  useImperativeHandle(
    ref,
    () => ({
      execute: () => innerRef.current?.execute() ?? NOOP_REF.execute(),
      reset: () => innerRef.current?.reset() ?? NOOP_REF.reset(),
    }),
    [],
  );

  if (!mounted) return null;
  return <TurnstileWidget ref={innerRef} {...rest} />;
});

Captcha.displayName = "Captcha";
