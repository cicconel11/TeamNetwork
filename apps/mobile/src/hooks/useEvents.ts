import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STALE_TIME_MS = 30_000; // 30 seconds

export interface Event {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string | null;
  rsvp_count?: number;
  user_rsvp_status?: "going" | "maybe" | "not_going" | null;
}

interface UseEventsReturn {
  events: Event[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

export function useEvents(orgSlug: string): UseEventsReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchEvents = useCallback(async (overrideOrgId?: string) => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setEvents([]);
        setError(null);
        setLoading(false);
        orgIdRef.current = null;
        setOrgId(null);
      }
      return;
    }

    try {
      setLoading(true);

      let resolvedOrgId = overrideOrgId ?? orgIdRef.current;

      if (!resolvedOrgId) {
        // First get org ID from slug
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (orgError) throw orgError;
        resolvedOrgId = org.id;
        orgIdRef.current = resolvedOrgId;
        if (isMountedRef.current) {
          setOrgId(resolvedOrgId);
        }
      }

      // Get events for this organization
      const { data, error: eventsError } = await supabase
        .from("events")
        .select("*")
        .eq("organization_id", resolvedOrgId)
        .is("deleted_at", null)
        .order("start_date", { ascending: true });

      if (eventsError) {
        // If events table doesn't exist, return empty array
        if (eventsError.code === "42P01") {
          if (isMountedRef.current) {
            setEvents([]);
            setError(null);
          }
          return;
        }
        throw eventsError;
      }

      if (isMountedRef.current) {
        setEvents((data as Event[]) || []);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current) {
        // If table doesn't exist, don't treat as error
        const error = e as { code?: string; message: string };
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          setEvents([]);
          setError(null);
        } else {
          setError(error.message);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgSlug]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchEvents();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchEvents]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`events:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchEvents(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchEvents]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchEvents();
    }
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents, refetchIfStale };
}
