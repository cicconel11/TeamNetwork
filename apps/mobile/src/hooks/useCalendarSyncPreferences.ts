import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";
import {
  DEFAULT_CALENDAR_SYNC_PREFERENCES,
  normalizeCalendarSyncPreferences,
  type CalendarSyncPreferences,
} from "@/lib/schedules/mobile-schedule-settings";

interface UseCalendarSyncPreferencesReturn {
  preferences: CalendarSyncPreferences;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updatePreferences: (
    updates: Partial<CalendarSyncPreferences>
  ) => Promise<{ success: boolean; error?: string }>;
}

export function useCalendarSyncPreferences(
  orgId: string | null
): UseCalendarSyncPreferencesReturn {
  const isMountedRef = useRef(true);
  const [preferences, setPreferences] = useState<CalendarSyncPreferences>(
    DEFAULT_CALENDAR_SYNC_PREFERENCES
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setPreferences(DEFAULT_CALENDAR_SYNC_PREFERENCES);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetchWithAuth(
        `/api/calendar/preferences?organizationId=${encodeURIComponent(orgId)}`,
        { method: "GET" }
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Failed to load sync settings.");
      }

      if (isMountedRef.current) {
        setPreferences(normalizeCalendarSyncPreferences(data?.preferences));
      }
    } catch (e) {
      sentry.captureException(e as Error, {
        context: "useCalendarSyncPreferences.refetch",
        orgId: orgId ?? undefined,
      });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setPreferences(DEFAULT_CALENDAR_SYNC_PREFERENCES);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    refetch();

    return () => {
      isMountedRef.current = false;
    };
  }, [refetch]);

  const updatePreferences = useCallback(
    async (
      updates: Partial<CalendarSyncPreferences>
    ): Promise<{ success: boolean; error?: string }> => {
      if (!orgId) {
        return { success: false, error: "Organization not loaded" };
      }

      const previous = preferences;
      const next = { ...preferences, ...updates };
      setPreferences(next);
      setSaving(true);
      setError(null);

      try {
        const response = await fetchWithAuth("/api/calendar/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            preferences: updates,
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.message || data?.error || "Failed to save sync settings.");
        }

        if (isMountedRef.current) {
          setPreferences(normalizeCalendarSyncPreferences(data?.preferences ?? next));
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, {
          context: "useCalendarSyncPreferences.updatePreferences",
          orgId,
        });
        if (isMountedRef.current) {
          setPreferences(previous);
          setError((e as Error).message);
        }
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [orgId, preferences]
  );

  return {
    preferences,
    loading,
    saving,
    error,
    refetch,
    updatePreferences,
  };
}
