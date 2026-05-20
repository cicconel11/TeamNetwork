"use client";

import { useState, useCallback, useEffect } from "react";

export interface UseCaptchaReturn {
    token: string | null;
    isVerified: boolean;
    isLoading: boolean;
    error: string | null;
    onVerify: (token: string) => void;
    onExpire: () => void;
    onError: (error: string) => void;
    reset: () => void;
}

/**
 * Custom hook for managing Turnstile state in forms.
 * Provides token state management and callback handlers for the Captcha component.
 */
export function useCaptcha(): UseCaptchaReturn {
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Development mode bypass — only when no real site key is configured
    // (mirrors server-side bypass condition: development && !secretKey)
    useEffect(() => {
        const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
        if (process.env.NODE_ENV === "development" && !siteKey) {
            setToken("dev-bypass-token");
        }
    }, []);

    // E2E test bypass: automatically set token when bypass is enabled.
    // Hard-disabled in production regardless of the flag, so a misconfigured
    // env var can never short-circuit captcha in a live deploy.
    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        if (process.env.NEXT_PUBLIC_E2E_CAPTCHA_BYPASS === "true") {
            setToken("e2e-bypass-token");
        }
    }, []);

    const onVerify = useCallback((newToken: string) => {
        setToken(newToken);
        setError(null);
        setIsLoading(false);
    }, []);

    const onExpire = useCallback(() => {
        setToken(null);
        setError(null);
    }, []);

    const onError = useCallback((errorMessage: string) => {
        setToken(null);
        setError(errorMessage);
        setIsLoading(false);
    }, []);

    const reset = useCallback(() => {
        setToken(null);
        setError(null);
        setIsLoading(false);
    }, []);

    const isVerified = token !== null && token.length > 0;

    return {
        token,
        isVerified,
        isLoading,
        error,
        onVerify,
        onExpire,
        onError,
        reset,
    };
}
