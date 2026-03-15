"use client";

import { useEffect, type ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { initErrorCapture, setUserId } from "@/lib/errors/client";
import { createClient } from "@/lib/supabase/client";

interface ErrorBoundaryProviderProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Provider component that initializes error capture and wraps children
 * in an error boundary.
 *
 * Add this to your root layout to enable global error tracking.
 */
export function ErrorBoundaryProvider({
  children,
  fallback,
}: ErrorBoundaryProviderProps) {
  useEffect(() => {
    // Initialize global error handlers
    initErrorCapture();

    // Get Supabase client for auth state tracking
    const supabase = createClient();

    // Get initial user and set ID for error attribution
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id);
    });

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserId(session?.user?.id);
      }
    );

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>;
}
