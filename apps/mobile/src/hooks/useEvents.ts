import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

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
}

export function useEvents(orgSlug: string): UseEventsReturn {
  const isMountedRef = useRef(true);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async () => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setEvents([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // First get org ID from slug
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (orgError) throw orgError;

      // Get events for this organization
      const { data, error: eventsError } = await supabase
        .from("events")
        .select("*")
        .eq("organization_id", org.id)
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
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchEvents();

    return () => {
      isMountedRef.current = false;
    };
  }, [orgSlug]);

  return { events, loading, error, refetch: fetchEvents };
}
