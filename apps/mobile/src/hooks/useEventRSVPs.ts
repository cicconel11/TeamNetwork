import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface EventRSVP {
  id: string;
  event_id: string;
  user_id: string;
  organization_id: string;
  status: "attending" | "not_attending" | "maybe";
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
        status: rsvp.status,
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

    const channel = supabase
      .channel(`event_rsvps:${eventId}`)
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
        const { data: userData } = await supabase.auth.getUser();
        const currentUserId = userData.user?.id;

        if (!currentUserId) {
          return { success: false, error: "Not authenticated" };
        }

        const { error: updateError } = await supabase
          .from("event_rsvps")
          .update({
            checked_in_at: new Date().toISOString(),
            checked_in_by: currentUserId,
          })
          .eq("id", rsvpId);

        if (updateError) {
          return { success: false, error: updateError.message };
        }

        // Update local state optimistically
        if (isMountedRef.current) {
          setRsvps((prev) =>
            prev.map((rsvp) =>
              rsvp.id === rsvpId
                ? {
                    ...rsvp,
                    checked_in_at: new Date().toISOString(),
                    checked_in_by: currentUserId,
                  }
                : rsvp
            )
          );
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    []
  );

  const undoCheckIn = useCallback(
    async (rsvpId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { error: updateError } = await supabase
          .from("event_rsvps")
          .update({
            checked_in_at: null,
            checked_in_by: null,
          })
          .eq("id", rsvpId);

        if (updateError) {
          return { success: false, error: updateError.message };
        }

        // Update local state optimistically
        if (isMountedRef.current) {
          setRsvps((prev) =>
            prev.map((rsvp) =>
              rsvp.id === rsvpId
                ? {
                    ...rsvp,
                    checked_in_at: null,
                    checked_in_by: null,
                  }
                : rsvp
            )
          );
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    []
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
    attendingCount,
    checkedInCount,
  };
}
