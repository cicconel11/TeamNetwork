import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import { track } from "@/lib/analytics";
import { normalizeRsvpStatus, type RsvpStatus } from "@teammeet/core";

export interface UseRsvpOptions {
  /**
   * Initial / known RSVP status for the current user (e.g. from
   * `events_with_user_rsvp` RPC). Used as the optimistic baseline.
   */
  initialStatus?: RsvpStatus | null;
}

interface UseRsvpReturn {
  /** Current user's RSVP status for this event, or null if no row exists. */
  status: RsvpStatus | null;
  /** Persist a new RSVP status (upsert). Optimistic with rollback. */
  setRsvp: (next: RsvpStatus) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Show the platform Alert picker ("Going / Maybe / Can't go") and persist
   * the selection. Resolves once the user makes a choice or cancels.
   */
  promptRsvp: () => void;
  /** True while a write is in flight. */
  saving: boolean;
}

const RSVP_PROMPT_TITLE = "RSVP";
const RSVP_PROMPT_MESSAGE = "Are you attending this event?";

/**
 * Low-level upsert helper. Shared by the `useRsvp` hook and any other
 * call site (home tab, etc.) that needs to persist an RSVP without holding
 * its own React state.
 */
export async function setEventRsvp(args: {
  eventId: string;
  organizationId: string;
  userId: string;
  status: RsvpStatus;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await supabase.from("event_rsvps").upsert(
      {
        event_id: args.eventId,
        user_id: args.userId,
        organization_id: args.organizationId,
        status: args.status,
      },
      { onConflict: "event_id,user_id" },
    );

    if (error) {
      sentry.captureException(error as unknown as Error, {
        context: "setEventRsvp",
        eventId: args.eventId,
        organizationId: args.organizationId,
        status: args.status,
      });
      return { ok: false, error: error.message };
    }

    track("event_rsvp_set", {
      event_id: args.eventId,
      org_id: args.organizationId,
      status: args.status,
    });
    return { ok: true };
  } catch (e) {
    sentry.captureException(e as Error, {
      context: "setEventRsvp.catch",
      eventId: args.eventId,
      organizationId: args.organizationId,
      status: args.status,
    });
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Open the platform Alert picker and persist the user's choice. Used by
 * call sites (event detail, home tab) that don't need full hook state.
 */
export function promptAndSetRsvp(args: {
  eventId: string;
  organizationId: string;
  userId: string;
  onComplete?: (result: { ok: boolean; status?: RsvpStatus; error?: string }) => void;
}) {
  const dispatch = (status: RsvpStatus) => {
    void setEventRsvp({
      eventId: args.eventId,
      organizationId: args.organizationId,
      userId: args.userId,
      status,
    }).then((result) => {
      if (!result.ok) {
        showToast("Couldn't save RSVP", "error");
      }
      args.onComplete?.(
        result.ok
          ? { ok: true, status }
          : { ok: false, error: result.error },
      );
    });
  };

  Alert.alert(RSVP_PROMPT_TITLE, RSVP_PROMPT_MESSAGE, [
    { text: "Going", onPress: () => dispatch("attending") },
    { text: "Maybe", onPress: () => dispatch("maybe") },
    { text: "Can't Go", style: "destructive", onPress: () => dispatch("not_attending") },
    { text: "Cancel", style: "cancel" },
  ]);
}

/**
 * Manages a single user's RSVP for one event. Performs an optimistic
 * upsert against `event_rsvps`, rolling back on error. The picker uses
 * the platform `Alert.alert` for now — when we add a richer custom
 * sheet we can swap it here without changing call sites.
 */
export function useRsvp(
  eventId: string | null | undefined,
  organizationId: string | null | undefined,
  options?: UseRsvpOptions,
): UseRsvpReturn {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const initial = normalizeRsvpStatus(options?.initialStatus ?? null);
  const [status, setStatus] = useState<RsvpStatus | null>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync with caller-provided initial status (e.g. when the parent's data
  // refetches and surfaces a new value).
  useEffect(() => {
    setStatus(normalizeRsvpStatus(options?.initialStatus ?? null));
  }, [options?.initialStatus]);

  const setRsvp = useCallback(
    async (
      next: RsvpStatus,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!eventId || !organizationId || !userId) {
        return { ok: false, error: "Missing event, organization, or user" };
      }
      if (inFlightRef.current) {
        return { ok: false, error: "Already saving" };
      }

      const previous = status;
      inFlightRef.current = true;
      if (isMountedRef.current) {
        setStatus(next);
        setSaving(true);
      }

      const result = await setEventRsvp({
        eventId,
        organizationId,
        userId,
        status: next,
      });

      if (!result.ok) {
        if (isMountedRef.current) setStatus(previous);
        showToast("Couldn't save RSVP", "error");
      }

      inFlightRef.current = false;
      if (isMountedRef.current) setSaving(false);
      return result;
    },
    [eventId, organizationId, userId, status],
  );

  const promptRsvp = useCallback(() => {
    if (!eventId || !organizationId || !userId) return;
    Alert.alert(RSVP_PROMPT_TITLE, RSVP_PROMPT_MESSAGE, [
      { text: "Going", onPress: () => void setRsvp("attending") },
      { text: "Maybe", onPress: () => void setRsvp("maybe") },
      { text: "Can't Go", style: "destructive", onPress: () => void setRsvp("not_attending") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [eventId, organizationId, userId, setRsvp]);

  return { status, setRsvp, promptRsvp, saving };
}
