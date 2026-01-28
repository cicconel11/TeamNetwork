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
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMountedRef.current) {
        setSession(session);
        setIsLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, newSession: Session | null) => {
      if (isMountedRef.current) {
        setSession(newSession);
        setIsLoading(false);
      }
    });

    return () => {
      isMountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, []);

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
