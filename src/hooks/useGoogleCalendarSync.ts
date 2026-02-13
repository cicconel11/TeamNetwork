"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SyncPreferences } from "@/components/settings/GoogleCalendarSyncPanel";

interface CalendarConnection {
  googleEmail: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
}

interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
}

interface UseGoogleCalendarSyncOptions {
  orgId: string;
  orgSlug: string;
  redirectPath?: string;
}

interface UseGoogleCalendarSyncReturn {
  connection: CalendarConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  calendars: GoogleCalendar[];
  calendarsLoading: boolean;
  targetCalendarId: string;
  preferences: SyncPreferences;
  preferencesLoading: boolean;
  oauthStatus: string | null;
  oauthError: string | null;
  oauthErrorMessage: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<{ message: string; syncedCount?: number; failedCount?: number }>;
  updatePreferences: (prefs: SyncPreferences) => Promise<void>;
  setTargetCalendar: (calendarId: string) => Promise<void>;
  reconnect: () => void;
  reconnectRequired: boolean;
}

const DEFAULT_PREFERENCES: SyncPreferences = {
  sync_general: true,
  sync_game: true,
  sync_meeting: true,
  sync_social: true,
  sync_fundraiser: true,
  sync_philanthropy: true,
};

export function useGoogleCalendarSync({
  orgId,
  orgSlug,
  redirectPath,
}: UseGoogleCalendarSyncOptions): UseGoogleCalendarSyncReturn {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [targetCalendarId, setTargetCalendarId] = useState("primary");
  const [preferences, setPreferences] = useState<SyncPreferences>(DEFAULT_PREFERENCES);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [reconnectRequired, setReconnectRequired] = useState(false);

  // Ref to read targetCalendarId inside loadCalendars without adding it as a
  // dependency (which would cause a re-render loop via the useEffect that
  // calls loadCalendars when isConnected changes).
  const targetCalendarIdRef = useRef(targetCalendarId);
  useEffect(() => {
    targetCalendarIdRef.current = targetCalendarId;
  }, [targetCalendarId]);

  const oauthStatus = searchParams.get("calendar");
  const oauthError = searchParams.get("error");
  const oauthErrorMessage = searchParams.get("error_message");

  const effectiveRedirectPath = redirectPath || `/${orgSlug}/calendar`;

  // Load connection status
  const loadConnection = useCallback(async () => {
    setConnectionLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setConnectionLoading(false);
        return;
      }

      const { data } = await supabase
        .from("user_calendar_connections")
        .select("google_email, status, last_sync_at, target_calendar_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        setConnection({
          googleEmail: data.google_email,
          status: data.status,
          lastSyncAt: data.last_sync_at,
        });
        setTargetCalendarId(data.target_calendar_id);
      } else {
        setConnection(null);
      }
    } catch {
      // Silently continue
    } finally {
      setConnectionLoading(false);
    }
  }, [supabase]);

  // Set target calendar (defined before loadCalendars which depends on it)
  const setTargetCalendar = useCallback(async (calendarId: string) => {
    const response = await fetch("/api/calendar/target", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetCalendarId: calendarId }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "Failed to update target calendar");
    }
    setTargetCalendarId(calendarId);
  }, []);

  // Load Google Calendar list
  const loadCalendars = useCallback(async () => {
    setCalendarsLoading(true);
    setReconnectRequired(false);
    try {
      const response = await fetch("/api/google/calendars");
      if (response.status === 403) {
        const data = await response.json();
        if (data.error === "reconnect_required") {
          setReconnectRequired(true);
          setCalendars([]);
          return;
        }
      }
      // 404 means server couldn't get a valid token (expired/revoked);
      // the server-side refreshAndStoreToken likely already updated the
      // DB status to "disconnected", so reload the connection row.
      if (response.status === 404) {
        setReconnectRequired(true);
        setCalendars([]);
        await loadConnection();
        return;
      }
      if (!response.ok) return;
      if (response.ok) {
        const data = await response.json();
        const cals: GoogleCalendar[] = data.calendars || [];
        setCalendars(cals);

        // One-time normalization: resolve "primary" alias to actual calendar ID
        // so the dropdown value matches an option and mismatch detection works.
        if (targetCalendarIdRef.current === "primary") {
          const primaryCal = cals.find((c) => c.primary);
          if (primaryCal && primaryCal.id && primaryCal.id !== "primary") {
            try {
              await setTargetCalendar(primaryCal.id);
            } catch {
              // Best-effort: next page load will retry
            }
          }
        }
      }
    } catch {
      // Silently continue
    } finally {
      setCalendarsLoading(false);
    }
  }, [setTargetCalendar, loadConnection]);

  // Load sync preferences
  const loadPreferences = useCallback(async () => {
    setPreferencesLoading(true);
    try {
      const response = await fetch(`/api/calendar/preferences?organizationId=${orgId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.preferences) {
          setPreferences(data.preferences);
        }
      }
    } catch {
      // Silently continue
    } finally {
      setPreferencesLoading(false);
    }
  }, [orgId]);

  // Initial load
  useEffect(() => {
    loadConnection();
    loadPreferences();
  }, [loadConnection, loadPreferences]);

  // Load calendars when connected
  const isConnected = connection?.status === "connected";
  useEffect(() => {
    if (isConnected) {
      loadCalendars();
    } else {
      setCalendars([]);
      setCalendarsLoading(false);
    }
  }, [isConnected, loadCalendars]);

  const connect = useCallback(() => {
    window.location.href = `/api/google/auth?redirect=${encodeURIComponent(effectiveRedirectPath)}`;
  }, [effectiveRedirectPath]);

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  const disconnect = useCallback(async () => {
    const response = await fetch("/api/google/disconnect", { method: "POST" });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "Failed to disconnect");
    }
    setConnection(null);
    setCalendars([]);
    setReconnectRequired(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("calendar:refresh"));
    }
  }, []);

  const syncNow = useCallback(async () => {
    const response = await fetch("/api/calendar/sync", { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to sync");
    }
    await loadConnection();
    return {
      message: data?.message || "Sync completed.",
      syncedCount: data?.syncedCount,
      failedCount: data?.failedCount,
    };
  }, [loadConnection]);

  const updatePreferences = useCallback(async (prefs: SyncPreferences) => {
    const response = await fetch("/api/calendar/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, preferences: prefs }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "Failed to save preferences");
    }
    setPreferences(prefs);
  }, [orgId]);

  return {
    connection,
    isConnected: isConnected || false,
    connectionLoading,
    calendars,
    calendarsLoading,
    targetCalendarId,
    preferences,
    preferencesLoading,
    oauthStatus,
    oauthError,
    oauthErrorMessage,
    connect,
    disconnect,
    syncNow,
    updatePreferences,
    setTargetCalendar,
    reconnect,
    reconnectRequired,
  };
}
