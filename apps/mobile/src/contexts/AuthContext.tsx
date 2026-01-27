/**
 * AuthContext
 * Single source of truth for auth state across the app.
 * Eliminates redundant getSession()/getUser() calls.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Session, User, AuthChangeEvent } from "@supabase/supabase-js";

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  initialSession?: Session | null;
  initialLoading?: boolean;
}

export function AuthProvider({
  children,
  initialSession = null,
  initialLoading = true,
}: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [isLoading, setIsLoading] = useState(initialLoading);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    // Only fetch session if not provided initially
    if (initialSession === null && initialLoading) {
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (!isMountedRef.current) return;

        // Handle invalid/expired refresh token errors gracefully
        if (error) {
          console.warn("AuthContext: Session error, clearing session:", error.message);
          supabase.auth.signOut().catch(() => {});
          setSession(null);
          setIsLoading(false);
          return;
        }

        setSession(session);
        setIsLoading(false);
      }).catch((err) => {
        console.warn("AuthContext: getSession failed:", err?.message || err);
        if (!isMountedRef.current) return;
        supabase.auth.signOut().catch(() => {});
        setSession(null);
        setIsLoading(false);
      });
    }

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, newSession: Session | null) => {
      if (!isMountedRef.current) return;

      // Handle token refresh failures
      if (event === "TOKEN_REFRESHED" && !newSession) {
        console.warn("AuthContext: Token refresh failed, clearing session");
        supabase.auth.signOut().catch(() => {});
        setSession(null);
        setIsLoading(false);
        return;
      }

      setSession(newSession);
      setIsLoading(false);
    });

    return () => {
      isMountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, [initialSession, initialLoading]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        isLoading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Hook to get auth state without throwing if context is missing.
 * Useful for components that may render before AuthProvider is mounted.
 */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
