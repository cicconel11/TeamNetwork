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
 * Custom hook for managing hCaptcha state in forms.
 * Provides token state management and callback handlers for the HCaptcha component.
 *
 * @example
 * ```tsx
 * const { token, isVerified, onVerify, onExpire, onError, reset } = useCaptcha();
 *
 * return (
 *   <form onSubmit={handleSubmit}>
 *     <HCaptcha onVerify={onVerify} onExpire={onExpire} onError={onError} />
 *     <button type="submit" disabled={!isVerified}>Submit</button>
 *   </form>
 * );
 * ```
 */
export function useCaptcha(): UseCaptchaReturn {
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // E2E test bypass: automatically set token when bypass is enabled
    useEffect(() => {
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
