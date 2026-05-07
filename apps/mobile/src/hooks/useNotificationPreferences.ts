import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";

export interface NotificationPreferences {
  id: string;
  email_address: string | null;
  email_enabled: boolean;
  push_enabled: boolean;
  // Per-category push gating (P0a). Defaults mirror the migration:
  //   announcement / chat / event_reminder → true
  //   event / workout / competition / discussion / mentorship / donation → false
  announcement_push_enabled: boolean;
  chat_push_enabled: boolean;
  event_reminder_push_enabled: boolean;
  event_push_enabled: boolean;
  workout_push_enabled: boolean;
  competition_push_enabled: boolean;
  discussion_push_enabled: boolean;
  mentorship_push_enabled: boolean;
  donation_push_enabled: boolean;
}

const DEFAULT_PUSH_CATEGORIES = {
  announcement_push_enabled: true,
  chat_push_enabled: true,
  event_reminder_push_enabled: true,
  event_push_enabled: false,
  workout_push_enabled: false,
  competition_push_enabled: false,
  discussion_push_enabled: false,
  mentorship_push_enabled: false,
  donation_push_enabled: false,
} as const;

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

const SELECT_COLUMNS = [
  "id",
  "email_address",
  "email_enabled",
  "push_enabled",
  "announcement_push_enabled",
  "chat_push_enabled",
  "event_reminder_push_enabled",
  "event_push_enabled",
  "workout_push_enabled",
  "competition_push_enabled",
  "discussion_push_enabled",
  "mentorship_push_enabled",
  "donation_push_enabled",
].join(",");

type PrefRow = {
  id: string;
  email_address: string | null;
  email_enabled: boolean | null;
  push_enabled: boolean | null;
  announcement_push_enabled: boolean | null;
  chat_push_enabled: boolean | null;
  event_reminder_push_enabled: boolean | null;
  event_push_enabled: boolean | null;
  workout_push_enabled: boolean | null;
  competition_push_enabled: boolean | null;
  discussion_push_enabled: boolean | null;
  mentorship_push_enabled: boolean | null;
  donation_push_enabled: boolean | null;
};

function rowToPrefs(row: PrefRow): NotificationPreferences {
  return {
    id: row.id,
    email_address: row.email_address,
    email_enabled: row.email_enabled ?? true,
    push_enabled: row.push_enabled ?? true,
    announcement_push_enabled:
      row.announcement_push_enabled ?? DEFAULT_PUSH_CATEGORIES.announcement_push_enabled,
    chat_push_enabled: row.chat_push_enabled ?? DEFAULT_PUSH_CATEGORIES.chat_push_enabled,
    event_reminder_push_enabled:
      row.event_reminder_push_enabled ?? DEFAULT_PUSH_CATEGORIES.event_reminder_push_enabled,
    event_push_enabled: row.event_push_enabled ?? DEFAULT_PUSH_CATEGORIES.event_push_enabled,
    workout_push_enabled: row.workout_push_enabled ?? DEFAULT_PUSH_CATEGORIES.workout_push_enabled,
    competition_push_enabled:
      row.competition_push_enabled ?? DEFAULT_PUSH_CATEGORIES.competition_push_enabled,
    discussion_push_enabled:
      row.discussion_push_enabled ?? DEFAULT_PUSH_CATEGORIES.discussion_push_enabled,
    mentorship_push_enabled:
      row.mentorship_push_enabled ?? DEFAULT_PUSH_CATEGORIES.mentorship_push_enabled,
    donation_push_enabled:
      row.donation_push_enabled ?? DEFAULT_PUSH_CATEGORIES.donation_push_enabled,
  };
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
  const { beginRequest, isCurrentRequest } = useRequestTracker();
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;

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

      const { data, error: fetchError } = await supabase
        .from("notification_preferences")
        .select(SELECT_COLUMNS)
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle<PrefRow>();

      if (fetchError) throw fetchError;

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        if (data) {
          setPrefs(rowToPrefs(data));
        } else {
          // Defaults when no row exists yet.
          setPrefs({
            id: "",
            email_address: userEmail,
            email_enabled: true,
            push_enabled: true,
            ...DEFAULT_PUSH_CATEGORIES,
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
  }, [beginRequest, isCurrentRequest, orgId, userEmail, userId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchPrefs();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPrefs]);

  // Reset displayed state when the active org/user changes so the user
  // doesn't briefly see another tuple's prefs while the new fetch runs.
  // We deliberately do NOT call invalidateRequests() here: fetchPrefs's own
  // beginRequest() already bumps the version when org/user changes, and
  // invalidating in a separate effect races with the fetch effect on
  // initial mount (the fetch starts request v=1, this effect would bump
  // to v=2, then the resolve sees isCurrentRequest(1)===false and never
  // clears loading — symptom: Notifications spinner stuck forever).
  useEffect(() => {
    setPrefs(null);
    setError(null);
  }, [orgId, userId]);

  // Realtime subscription
  useEffect(() => {
    if (!orgId || !userId) return;

    const channel = createPostgresChangesChannel(`notification-prefs:${orgId}:${userId}`)
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
      const writePayload: Record<string, unknown> = {};

      // Email writes (preserve existing behavior)
      if ("email_address" in updates) {
        writePayload.email_address = updates.email_address ?? prefs?.email_address ?? userEmail;
      }
      if ("email_enabled" in updates) {
        writePayload.email_enabled = updates.email_enabled ?? prefs?.email_enabled ?? true;
      }

      // Push writes
      if ("push_enabled" in updates) {
        writePayload.push_enabled = updates.push_enabled ?? prefs?.push_enabled ?? true;
      }
      const pushCategoryKeys = [
        "announcement_push_enabled",
        "chat_push_enabled",
        "event_reminder_push_enabled",
        "event_push_enabled",
        "workout_push_enabled",
        "competition_push_enabled",
        "discussion_push_enabled",
        "mentorship_push_enabled",
        "donation_push_enabled",
      ] as const;
      for (const key of pushCategoryKeys) {
        if (key in updates) {
          writePayload[key] = updates[key] ?? prefs?.[key] ?? DEFAULT_PUSH_CATEGORIES[key];
        }
      }

      // Optimistic update
      setPrefs((prev) => (prev ? { ...prev, ...updates } : prev));
      setSaving(true);
      setError(null);

      try {
        if (prefs?.id) {
          // Cast: the new *_push_enabled columns aren't in the generated
          // Database types yet (regenerate via `bun run gen:types` after
          // migration applies in prod).
          const { error: updateError } = await (supabase
            .from("notification_preferences") as unknown as {
              update: (v: Record<string, unknown>) => {
                eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
              };
            })
            .update(writePayload)
            .eq("id", prefs.id);

          if (updateError) throw updateError;
        } else {
          // Insert new preferences. Defaults from the migration handle any
          // unset *_push_enabled columns; we still write what the caller set.
          const insertPayload: Record<string, unknown> = {
            organization_id: orgId,
            user_id: userId,
            email_address: writePayload.email_address ?? userEmail,
            email_enabled: writePayload.email_enabled ?? true,
            phone_number: null,
            sms_enabled: false,
            push_enabled: writePayload.push_enabled ?? true,
            ...Object.fromEntries(
              pushCategoryKeys
                .filter((k) => k in writePayload)
                .map((k) => [k, writePayload[k]])
            ),
          };

          const { data, error: insertError } = await (supabase
            .from("notification_preferences") as unknown as {
              insert: (v: Record<string, unknown>) => {
                select: (cols: string) => {
                  single: () => Promise<{
                    data: { id: string } | null;
                    error: { message: string } | null;
                  }>;
                };
              };
            })
            .insert(insertPayload)
            .select("id")
            .single();

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
    [orgId, prefs, userEmail, userId]
  );

  return { prefs, loading, error, saving, updatePrefs, refetch: fetchPrefs };
}
