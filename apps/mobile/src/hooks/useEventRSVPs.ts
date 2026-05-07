import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import { normalizeRsvpStatus, type RsvpStatus } from "@teammeet/core";

function coerceRsvpStatus(status: string | null | undefined): RsvpStatus {
  return normalizeRsvpStatus(status) ?? "maybe";
}

export interface EventRSVP {
  id: string;
  event_id: string;
  user_id: string;
  organization_id: string;
  status: RsvpStatus;
  checked_in_at: string | null;
  checked_in_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatar_url: string | null;
  } | null;
}

interface UseEventRSVPsReturn {
  rsvps: EventRSVP[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  checkInAttendee: (rsvpId: string) => Promise<{ success: boolean; error?: string }>;
  undoCheckIn: (rsvpId: string) => Promise<{ success: boolean; error?: string }>;
  findRsvpByUserId: (userId: string) => EventRSVP | undefined;
  attendingCount: number;
  checkedInCount: number;
}

export function useEventRSVPs(eventId: string | undefined): UseEventRSVPsReturn {
  const isMountedRef = useRef(true);
  const [rsvps, setRsvps] = useState<EventRSVP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRSVPs = useCallback(async () => {
    if (!eventId) {
      if (isMountedRef.current) {
        setRsvps([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      const { data, error: fetchError } = await supabase
        .from("event_rsvps")
        .select(`
          id,
          event_id,
          user_id,
          organization_id,
          status,
          checked_in_at,
          checked_in_by,
          created_at,
          updated_at,
          users:user_id (
            id,
            name,
            email,
            avatar_url
          )
        `)
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });

      if (fetchError) throw fetchError;

      // Transform the data to flatten the user object
      const transformedData: EventRSVP[] = (data || []).map((rsvp) => ({
        id: rsvp.id,
        event_id: rsvp.event_id,
        user_id: rsvp.user_id,
        organization_id: rsvp.organization_id,
        status: coerceRsvpStatus(rsvp.status),
        checked_in_at: rsvp.checked_in_at,
        checked_in_by: rsvp.checked_in_by,
        created_at: rsvp.created_at,
        updated_at: rsvp.updated_at,
        user: Array.isArray(rsvp.users) ? rsvp.users[0] : rsvp.users,
      }));

      if (isMountedRef.current) {
        setRsvps(transformedData);
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useEventRSVPs.fetchRSVPs" });
      if (isMountedRef.current) {
        const error = e as { message: string };
        setError(error.message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [eventId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchRSVPs();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchRSVPs]);

  // Real-time subscription
  useEffect(() => {
    if (!eventId) return;

    const channel = createPostgresChangesChannel(`event_rsvps:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_rsvps",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          fetchRSVPs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, fetchRSVPs]);

  const checkInAttendee = useCallback(
    async (rsvpId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc(
          "check_in_event_attendee",
          { p_rsvp_id: rsvpId, p_undo: false }
        );

        if (rpcError) {
          return { success: false, error: rpcError.message };
        }

        const parsed =
          rpcResult &&
          typeof rpcResult === "object" &&
          "success" in (rpcResult as object)
            ? (rpcResult as { success?: boolean; error?: string })
            : null;

        if (!parsed || parsed.success !== true) {
          return {
            success: false,
            error: typeof parsed?.error === "string" ? parsed.error : "Check-in failed",
          };
        }

        const { data: userData } = await supabase.auth.getUser();
        const currentUserId = userData.user?.id;
        const nowIso = new Date().toISOString();

        if (isMountedRef.current && currentUserId) {
          setRsvps((prev) =>
            prev.map((rsvp) =>
              rsvp.id === rsvpId
                ? {
                    ...rsvp,
                    checked_in_at: nowIso,
                    checked_in_by: currentUserId,
                  }
                : rsvp,
            ),
          );
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useEventRSVPs.checkInAttendee" });
        return { success: false, error: (e as Error).message };
      }
    },
    [],
  );

  const undoCheckIn = useCallback(
    async (rsvpId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc(
          "check_in_event_attendee",
          { p_rsvp_id: rsvpId, p_undo: true },
        );

        if (rpcError) {
          return { success: false, error: rpcError.message };
        }

        const parsed =
          rpcResult &&
          typeof rpcResult === "object" &&
          "success" in (rpcResult as object)
            ? (rpcResult as { success?: boolean; error?: string })
            : null;

        if (!parsed || parsed.success !== true) {
          return {
            success: false,
            error:
              typeof parsed?.error === "string" ? parsed.error : "Failed to undo check-in",
          };
        }

        if (isMountedRef.current) {
          setRsvps((prev) =>
            prev.map((rsvp) =>
              rsvp.id === rsvpId
                ? {
                    ...rsvp,
                    checked_in_at: null,
                    checked_in_by: null,
                  }
                : rsvp,
            ),
          );
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useEventRSVPs.undoCheckIn" });
        return { success: false, error: (e as Error).message };
      }
    },
    [],
  );

  const findRsvpByUserId = useCallback(
    (userId: string) => rsvps.find((r) => r.user_id === userId),
    [rsvps]
  );

  // Computed values
  const attendingCount = rsvps.filter((r) => r.status === "attending").length;
  const checkedInCount = rsvps.filter((r) => r.checked_in_at !== null).length;

  return {
    rsvps,
    loading,
    error,
    refetch: fetchRSVPs,
    checkInAttendee,
    undoCheckIn,
    findRsvpByUserId,
    attendingCount,
    checkedInCount,
  };
}
