/**
 * AuthContext
 * Single source of truth for auth state across the app.
 * Eliminates redundant getSession()/getUser() calls.
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import { signOutCleanup } from "@/lib/lifecycle";
import { listSyncedOrgIds, removeAllOrgCalendars } from "@/lib/native-calendar";
import { setOrgCalendarSyncEnabled } from "@/lib/native-calendar-prefs";
import { Alert } from "react-native";
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
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    isMountedRef.current = true;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (isMountedRef.current) {
          setSession(session);
        }
      })
      .catch((error: Error) => {
        sentry.captureException(error, { context: "AuthContext.getSession" });
        if (isMountedRef.current) {
          setSession(null);
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
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
    // Offer to remove device calendars created for this user. Default Yes —
    // the next signed-in user shouldn't inherit the previous user's events.
    const syncedOrgIds = await listSyncedOrgIds().catch(() => [] as string[]);
    if (syncedOrgIds.length > 0) {
      // Race the user's choice against a 30s timeout that defaults to "Keep".
      // If the OS dismisses the alert (incoming call, JS reload, system
      // dialog), the promise would otherwise hang forever and sign-out
      // would never complete.
      const removeCalendars = await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (value: boolean) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const timeoutId = setTimeout(() => settle(false), 30_000);
        Alert.alert(
          "Remove TeamMeet calendars?",
          `You have ${syncedOrgIds.length} TeamMeet calendar${
            syncedOrgIds.length === 1 ? "" : "s"
          } on this device. Remove them when signing out?`,
          [
            {
              text: "Keep",
              style: "cancel",
              onPress: () => {
                clearTimeout(timeoutId);
                settle(false);
              },
            },
            {
              text: "Remove",
              style: "destructive",
              onPress: () => {
                clearTimeout(timeoutId);
                settle(true);
              },
            },
          ],
          { cancelable: false }
        );
      });
      if (removeCalendars) {
        try {
          await removeAllOrgCalendars();
          await Promise.all(
            syncedOrgIds.map((orgId) => setOrgCalendarSyncEnabled(orgId, false))
          );
        } catch {
          // Best-effort; sign-out continues even if removal fails.
        }
      }
    }

    // Run cleanup BEFORE signOut so RLS-gated deletes (push tokens) succeed.
    const userId = sessionRef.current?.user?.id;
    if (userId) {
      await signOutCleanup({ userId });
    }
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    isLoading,
    signOut,
  }), [session, isLoading, signOut]);

  return (
    <AuthContext.Provider value={value}>
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
