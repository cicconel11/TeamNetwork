"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export interface TurnstileWidgetProps {
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  theme?: "light" | "dark";
  size?: "normal" | "compact" | "invisible";
  className?: string;
}

export interface TurnstileWidgetRef {
  execute: () => void;
  reset: () => void;
}

export const TurnstileWidget = forwardRef<TurnstileWidgetRef, TurnstileWidgetProps>(
  (
    {
      siteKey,
      onVerify,
      onExpire,
      onError,
      theme = "light",
      size = "normal",
      className = "",
    },
    ref,
  ) => {
    const widgetRef = useRef<TurnstileInstance | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [timedOut, setTimedOut] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const resolvedSiteKey = siteKey || TURNSTILE_SITE_KEY;

    useImperativeHandle(ref, () => ({
      execute: () => widgetRef.current?.execute(),
      reset: () => widgetRef.current?.reset(),
    }));

    const handleSuccess = useCallback(
      (token: string) => {
        setError(null);
        onVerify(token);
      },
      [onVerify],
    );

    const handleExpire = useCallback(() => {
      onExpire?.();
    }, [onExpire]);

    const handleError = useCallback(
      (event: string) => {
        setError("Captcha challenge failed. Please try again.");
        onError?.(event);
      },
      [onError],
    );

    const handleLoadScript = useCallback(() => {
      setIsLoading(false);
      setTimedOut(false);
    }, []);

    useEffect(() => {
      const timer = setTimeout(() => {
        if (isLoading) setTimedOut(true);
      }, 8000);
      return () => clearTimeout(timer);
    }, [isLoading]);

    if (process.env.NODE_ENV === "development" && !resolvedSiteKey) {
      return (
        <div className={`text-xs text-muted-foreground ${className}`}>
          Captcha bypassed (dev mode)
        </div>
      );
    }

    if (!resolvedSiteKey) {
      return (
        <div
          className={`text-error text-sm ${className}`}
          role="alert"
          aria-live="polite"
        >
          Turnstile configuration error: Site key is missing
        </div>
      );
    }

    return (
      <div className={`relative ${className}`}>
        {isLoading && !timedOut && (
          <div
            className="flex items-center justify-center p-4 text-muted-foreground"
            role="status"
            aria-label="Loading captcha"
          >
            <svg
              className="animate-spin h-5 w-5 mr-2"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Loading captcha...</span>
          </div>
        )}

        {isLoading && timedOut && (
          <div
            className="flex flex-col items-center justify-center p-4 text-muted-foreground text-sm"
            role="alert"
          >
            <p>Captcha failed to load. This may be caused by an ad blocker.</p>
            <button
              type="button"
              className="mt-2 text-primary underline hover:no-underline"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        )}

        {error && (
          <div
            className="text-error text-sm mb-2"
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        <div className={isLoading ? "invisible absolute" : ""}>
          <Turnstile
            ref={widgetRef}
            siteKey={resolvedSiteKey}
            onSuccess={handleSuccess}
            onExpire={handleExpire}
            onError={handleError}
            onLoadScript={handleLoadScript}
            options={{ theme, size: size === "invisible" ? "invisible" : size }}
          />
        </div>
      </div>
    );
  },
);

TurnstileWidget.displayName = "TurnstileWidget";
