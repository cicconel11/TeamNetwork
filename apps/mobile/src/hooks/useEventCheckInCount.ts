import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, createPostgresChangesChannel } from "@/lib/supabase";

/**
 * Returns the count of users marked `attending` for an event who have also
 * been checked in (`checked_in_at IS NOT NULL`). Subscribes to realtime
 * updates on `event_rsvps` filtered to the event so the count refreshes as
 * people check in / out.
 */
export function useEventCheckInCount(eventId: string | null): {
  count: number;
  loading: boolean;
} {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState<boolean>(eventId !== null);
  const isMountedRef = useRef(true);

  const fetchCount = useCallback(async () => {
    if (!eventId) {
      setCount(0);
      setLoading(false);
      return;
    }

    const { count: rowCount, error } = await supabase
      .from("event_rsvps")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", "attending")
      .not("checked_in_at", "is", null);

    if (!isMountedRef.current) return;

    if (error) {
      setLoading(false);
      return;
    }

    setCount(rowCount ?? 0);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchCount();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchCount]);

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
          fetchCount();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, fetchCount]);

  return { count, loading };
}
