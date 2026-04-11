"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SyncPreferences } from "@/components/settings/GoogleCalendarSyncPanel";
import {
  resolveMicrosoftCalendarState,
  type MicrosoftCalendarListItem,
  type MicrosoftCalendarsApiBody,
} from "@/lib/microsoft/calendar-connection-state";

interface CalendarConnection {
  providerEmail: string;
  status: "connected" | "disconnected" | "reconnect_required" | "error";
  lastSyncAt: string | null;
}

export type OutlookCalendar = MicrosoftCalendarListItem;

interface UseOutlookCalendarSyncOptions {
  orgId: string;
  orgSlug: string;
  redirectPath?: string;
}

interface UseOutlookCalendarSyncReturn {
  connection: CalendarConnection | null;
  isConnected: boolean;
  connectionLoading: boolean;
  calendars: OutlookCalendar[];
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
  sync_practice: true,
  sync_workout: true,
};

export function useOutlookCalendarSync({
  orgId,
  orgSlug,
  redirectPath,
}: UseOutlookCalendarSyncOptions): UseOutlookCalendarSyncReturn {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [calendars, setCalendars] = useState<OutlookCalendar[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [targetCalendarId, setTargetCalendarId] = useState("primary");
  const [preferences, setPreferences] = useState<SyncPreferences>(DEFAULT_PREFERENCES);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [reconnectRequired, setReconnectRequired] = useState(false);

  const targetCalendarIdRef = useRef(targetCalendarId);
  useEffect(() => {
    targetCalendarIdRef.current = targetCalendarId;
  }, [targetCalendarId]);

  const oauthStatus = searchParams.get("calendar");
  const oauthError = searchParams.get("error");
  const oauthErrorMessage = searchParams.get("error_message");

  const effectiveRedirectPath = redirectPath || `/${orgSlug}/calendar/my-settings`;

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
        .select("provider_email, status, last_sync_at, target_calendar_id")
        .eq("user_id", user.id)
        .eq("provider", "outlook")
        .maybeSingle();

      if (data) {
        setConnection({
          providerEmail: data.provider_email,
          status: data.status as CalendarConnection["status"],
          lastSyncAt: data.last_sync_at,
        });
        setTargetCalendarId(data.target_calendar_id || "primary");
      } else {
        setConnection(null);
      }
    } catch {
      // Silently continue
    } finally {
      setConnectionLoading(false);
    }
  }, [supabase]);

  // Set target calendar
  const setTargetCalendar = useCallback(async (calendarId: string) => {
    const response = await fetch("/api/calendar/target", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetCalendarId: calendarId, provider: "outlook" }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "Failed to update target calendar");
    }
    setTargetCalendarId(calendarId);
  }, []);

  // Load Outlook Calendar list
  const loadCalendars = useCallback(async () => {
    setCalendarsLoading(true);
    setReconnectRequired(false);
    try {
      const response = await fetch("/api/microsoft/calendars?mode=personal");
      const data = (await response.json()) as MicrosoftCalendarsApiBody;
      const resolved = resolveMicrosoftCalendarState(response.status, data);

      if (resolved.reconnectRequired) {
        setReconnectRequired(true);
        setCalendars([]);
        return;
      }

      if (resolved.disconnected) {
        setReconnectRequired(false);
        setCalendars([]);
        return;
      }

      if (!response.ok) return;

      const cals = resolved.calendars;
      setCalendars(cals);

      // Normalize "primary" alias to the actual default calendar ID
      if (targetCalendarIdRef.current === "primary" || !targetCalendarIdRef.current) {
        const defaultCal = cals.find((c) => c.isDefault);
        if (defaultCal && defaultCal.id !== "primary") {
          try {
            await setTargetCalendar(defaultCal.id);
          } catch {
            // Best-effort
          }
        }
      }
    } catch {
      // Silently continue
    } finally {
      setCalendarsLoading(false);
    }
  }, [setTargetCalendar]);

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
    window.location.href = `/api/microsoft/auth?redirect=${encodeURIComponent(effectiveRedirectPath)}`;
  }, [effectiveRedirectPath]);

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  const disconnect = useCallback(async () => {
    const response = await fetch("/api/microsoft/disconnect", { method: "POST" });
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
