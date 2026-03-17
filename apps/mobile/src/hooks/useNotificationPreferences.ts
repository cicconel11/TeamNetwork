import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";

export interface NotificationPreferences {
  id: string;
  email_address: string | null;
  email_enabled: boolean;
  push_enabled: boolean;
}

interface UseNotificationPreferencesReturn {
  prefs: NotificationPreferences | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  updatePrefs: (updates: Partial<Omit<NotificationPreferences, "id">>) => Promise<{
    success: boolean;
    error?: string;
  }>;
  refetch: () => Promise<void>;
}

export function useNotificationPreferences(
  orgId: string | null
): UseNotificationPreferencesReturn {
  const { user } = useAuth();
  const isMountedRef = useRef(true);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;

  const isMissingPushEnabledColumnError = useCallback((value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const maybeError = value as { message?: string };
    return maybeError.message?.includes("push_enabled") ?? false;
  }, []);

  const fetchPrefs = useCallback(async () => {
    const requestId = beginRequest();

    if (!orgId || !userId) {
      setPrefs(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let { data, error: fetchError } = await supabase
        .from("notification_preferences")
        .select("id, email_address, email_enabled, push_enabled")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();

      if (fetchError && isMissingPushEnabledColumnError(fetchError)) {
        const fallback = await supabase
          .from("notification_preferences")
          .select("id, email_address, email_enabled")
          .eq("organization_id", orgId)
          .eq("user_id", userId)
          .maybeSingle();

        data = fallback.data
          ? {
              ...fallback.data,
              push_enabled: true,
            }
          : null;
        fetchError = fallback.error;
      }

      if (fetchError) throw fetchError;

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        if (data) {
          setPrefs({
            id: data.id,
            email_address: data.email_address,
            email_enabled: data.email_enabled ?? true,
            push_enabled: data.push_enabled ?? true,
          });
        } else {
          // Return defaults if no preferences exist yet
          setPrefs({
            id: "",
            email_address: userEmail,
            email_enabled: true,
            push_enabled: true,
          });
        }
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useNotificationPreferences.fetchPrefs" });
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setError((e as Error).message);
        setPrefs(null);
      }
    } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [beginRequest, isCurrentRequest, isMissingPushEnabledColumnError, orgId, userEmail, userId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchPrefs();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPrefs]);

  useEffect(() => {
    invalidateRequests();
    setPrefs(null);
    setError(null);
  }, [invalidateRequests, orgId, userId]);

  // Realtime subscription
  useEffect(() => {
    if (!orgId || !userId) return;

    const channel = supabase
      .channel(`notification-prefs:${orgId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notification_preferences",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          // Only refetch if it's for this user
          const newData = payload.new as { user_id?: string } | null;
          const oldData = payload.old as { user_id?: string } | null;
          if (newData?.user_id === userId || oldData?.user_id === userId) {
            fetchPrefs();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchPrefs, userId]);

  const updatePrefs = useCallback(
    async (
      updates: Partial<Omit<NotificationPreferences, "id">>
    ): Promise<{ success: boolean; error?: string }> => {
      if (!orgId || !userId) {
        return { success: false, error: "Not authenticated or no organization" };
      }

      const previousPrefs = prefs;
      const emailAddress = updates.email_address ?? prefs?.email_address ?? userEmail;
      const emailEnabled = updates.email_enabled ?? prefs?.email_enabled ?? true;
      const pushEnabled = updates.push_enabled ?? prefs?.push_enabled ?? true;
      const writePayload = {
        email_address: emailAddress,
        email_enabled: emailEnabled,
        push_enabled: pushEnabled,
      };
      const fallbackPayload = {
        email_address: emailAddress,
        email_enabled: emailEnabled,
      };

      // Optimistic update
      setPrefs((prev) => (prev ? { ...prev, ...updates } : prev));
      setSaving(true);
      setError(null);

      try {
        if (prefs?.id) {
          // Update existing preferences
          let { error: updateError } = await supabase
            .from("notification_preferences")
            .update(writePayload)
            .eq("id", prefs.id);

          if (updateError && isMissingPushEnabledColumnError(updateError)) {
            const fallback = await supabase
              .from("notification_preferences")
              .update(fallbackPayload)
              .eq("id", prefs.id);

            updateError = fallback.error;
          }

          if (updateError) throw updateError;
        } else {
          // Insert new preferences
          let { data, error: insertError } = await supabase
            .from("notification_preferences")
            .insert({
              organization_id: orgId,
              user_id: userId,
              ...writePayload,
              phone_number: null,
              sms_enabled: false,
            })
            .select("id")
            .single();

          if (insertError && isMissingPushEnabledColumnError(insertError)) {
            const fallback = await supabase
              .from("notification_preferences")
              .insert({
                organization_id: orgId,
                user_id: userId,
                ...fallbackPayload,
                phone_number: null,
                sms_enabled: false,
              })
              .select("id")
              .single();

            data = fallback.data;
            insertError = fallback.error;
          }

          if (insertError) throw insertError;

          if (isMountedRef.current && data) {
            setPrefs((prev) => (prev ? { ...prev, id: data.id } : prev));
          }
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useNotificationPreferences.updatePrefs" });
        // Rollback on error
        if (isMountedRef.current) {
          setPrefs(previousPrefs);
          setError((e as Error).message);
        }
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [isMissingPushEnabledColumnError, orgId, prefs, userEmail, userId]
  );

  return { prefs, loading, error, saving, updatePrefs, refetch: fetchPrefs };
}
