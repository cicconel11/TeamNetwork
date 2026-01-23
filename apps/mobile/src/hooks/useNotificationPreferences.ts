import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

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
  const isMountedRef = useRef(true);
  const userIdRef = useRef<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    if (!orgId) {
      setPrefs(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Not authenticated");
      }

      userIdRef.current = user.id;

      const { data, error: fetchError } = await supabase
        .from("notification_preferences")
        .select("id, email_address, email_enabled, push_enabled")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        if (data) {
          setPrefs(data);
        } else {
          // Return defaults if no preferences exist yet
          setPrefs({
            id: "",
            email_address: user.email ?? null,
            email_enabled: true,
            push_enabled: true,
          });
        }
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
        setPrefs(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchPrefs();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPrefs]);

  // Realtime subscription
  useEffect(() => {
    if (!orgId || !userIdRef.current) return;

    const userId = userIdRef.current;
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
  }, [orgId, fetchPrefs]);

  const updatePrefs = useCallback(
    async (
      updates: Partial<Omit<NotificationPreferences, "id">>
    ): Promise<{ success: boolean; error?: string }> => {
      if (!orgId || !userIdRef.current) {
        return { success: false, error: "Not authenticated or no organization" };
      }

      const previousPrefs = prefs;
      const userId = userIdRef.current;

      // Optimistic update
      setPrefs((prev) => (prev ? { ...prev, ...updates } : prev));
      setSaving(true);
      setError(null);

      try {
        if (prefs?.id) {
          // Update existing preferences
          const { error: updateError } = await supabase
            .from("notification_preferences")
            .update({
              email_address: updates.email_address ?? prefs.email_address,
              email_enabled: updates.email_enabled ?? prefs.email_enabled,
              push_enabled: updates.push_enabled ?? prefs.push_enabled,
            })
            .eq("id", prefs.id);

          if (updateError) throw updateError;
        } else {
          // Insert new preferences
          const { data: { user } } = await supabase.auth.getUser();
          
          const { data, error: insertError } = await supabase
            .from("notification_preferences")
            .insert({
              organization_id: orgId,
              user_id: userId,
              email_address: updates.email_address ?? user?.email ?? null,
              email_enabled: updates.email_enabled ?? true,
              push_enabled: updates.push_enabled ?? true,
              phone_number: null,
              sms_enabled: false,
            })
            .select("id")
            .single();

          if (insertError) throw insertError;

          if (isMountedRef.current && data) {
            setPrefs((prev) => (prev ? { ...prev, id: data.id } : prev));
          }
        }

        return { success: true };
      } catch (e) {
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
    [orgId, prefs]
  );

  return { prefs, loading, error, saving, updatePrefs, refetch: fetchPrefs };
}
