"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from "react";
import ReactHCaptcha from "@hcaptcha/react-hcaptcha";

export interface HCaptchaProps {
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  theme?: "light" | "dark";
  size?: "normal" | "compact" | "invisible";
  className?: string;
}

export interface HCaptchaRef {
  execute: () => void;
  reset: () => void;
}

/**
 * HCaptcha component wrapper for @hcaptcha/react-hcaptcha
 * Provides automatic site key loading, theme support, and loading/error states
 */
export const HCaptcha = forwardRef<HCaptchaRef, HCaptchaProps>(
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
    ref
  ) => {
    const captchaRef = useRef<ReactHCaptcha>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Use provided siteKey or fall back to environment variable
    const resolvedSiteKey =
      siteKey || process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "";

    // Expose execute and reset methods via ref
    useImperativeHandle(ref, () => ({
      execute: () => {
        captchaRef.current?.execute();
      },
      reset: () => {
        captchaRef.current?.resetCaptcha();
      },
    }));

    const handleVerify = useCallback(
      (token: string) => {
        setError(null);
        onVerify(token);
      },
      [onVerify]
    );

    const handleExpire = useCallback(() => {
      onExpire?.();
    }, [onExpire]);

    const handleError = useCallback(
      (event: string) => {
        setError(event);
        onError?.(event);
      },
      [onError]
    );

    const handleLoad = useCallback(() => {
      setIsLoading(false);
    }, []);

    // Show error if site key is missing
    if (!resolvedSiteKey) {
      return (
        <div
          className={`text-error text-sm ${className}`}
          role="alert"
          aria-live="polite"
        >
          hCaptcha configuration error: Site key is missing
        </div>
      );
    }

    return (
      <div className={`relative ${className}`}>
        {/* Loading indicator */}
        {isLoading && (
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

        {/* Error display */}
        {error && (
          <div
            className="text-error text-sm mb-2"
            role="alert"
            aria-live="polite"
          >
            Captcha error: {error}
          </div>
        )}

        {/* hCaptcha widget */}
        <div className={isLoading ? "invisible absolute" : ""}>
          <ReactHCaptcha
            ref={captchaRef}
            sitekey={resolvedSiteKey}
            onVerify={handleVerify}
            onExpire={handleExpire}
            onError={handleError}
            onLoad={handleLoad}
            theme={theme}
            size={size}
          />
        </div>
      </div>
    );
  }
);

HCaptcha.displayName = "HCaptcha";
