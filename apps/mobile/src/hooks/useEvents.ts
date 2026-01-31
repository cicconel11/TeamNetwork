import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STALE_TIME_MS = 30_000; // 30 seconds
const DEFAULT_PAGE_SIZE = 50;

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

interface UseEventsOptions {
  /** Number of records to fetch per page. Default: 50. Set to 0 to fetch all records. */
  limit?: number;
}

interface UseEventsReturn {
  events: Event[];
  loading: boolean;
  /** True while loading more records (not initial load) */
  loadingMore: boolean;
  error: string | null;
  /** True if there are more records to fetch */
  hasMore: boolean;
  /** Total count of events (if available) */
  totalCount: number | null;
  /** Fetch next page of results */
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/**
 * Hook to fetch events for an organization with pagination support.
 * @param orgId - The organization ID (from useOrg context)
 * @param options - Pagination options (limit defaults to 50, set to 0 for all)
 */
export function useEvents(
  orgId: string | null,
  options?: UseEventsOptions
): UseEventsReturn {
  const pageSize = options?.limit ?? DEFAULT_PAGE_SIZE;
  const isPaginated = pageSize > 0;

  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    lastFetchTimeRef.current = 0;
    setOffset(0);
    setHasMore(false);
    setTotalCount(null);
  }, [orgId]);

  const fetchEvents = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setEvents([]);
          setError(null);
          setLoading(false);
          setHasMore(false);
          setTotalCount(null);
        }
        return;
      }

      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }

        // Build query
        let query = supabase
          .from("events")
          .select("*", { count: "exact" })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .order("start_date", { ascending: true });

        // Apply pagination if enabled
        if (isPaginated) {
          query = query.range(fetchOffset, fetchOffset + pageSize - 1);
        }

        const { data, error: eventsError, count } = await query;

        if (eventsError) {
          // If events table doesn't exist, return empty array
          if (eventsError.code === "42P01") {
            if (isMountedRef.current) {
              setEvents([]);
              setError(null);
              setHasMore(false);
              setTotalCount(null);
            }
            return;
          }
          throw eventsError;
        }

        if (isMountedRef.current) {
          const newData = (data as Event[]) || [];

          if (append) {
            setEvents((prev) => [...prev, ...newData]);
          } else {
            setEvents(newData);
          }

          setError(null);
          lastFetchTimeRef.current = Date.now();

          if (count !== null) {
            setTotalCount(count);
            if (isPaginated) {
              setHasMore(fetchOffset + newData.length < count);
            }
          } else if (isPaginated) {
            // Fallback: check if we got a full page
            setHasMore(newData.length === pageSize);
          }

          setOffset(fetchOffset + newData.length);
        }
      } catch (e) {
        if (isMountedRef.current) {
          // If table doesn't exist, don't treat as error
          const err = e as { code?: string; message: string };
          if (err.code === "42P01" || err.message?.includes("does not exist")) {
            setEvents([]);
            setError(null);
            setHasMore(false);
            setTotalCount(null);
          } else {
            setError(err.message);
          }
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [orgId, pageSize, isPaginated]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    await fetchEvents(offset, true);
  }, [hasMore, loadingMore, loading, offset, fetchEvents]);

  const refetch = useCallback(async () => {
    setOffset(0);
    await fetchEvents(0, false);
  }, [fetchEvents]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchEvents(0, false);

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchEvents]);

  // Real-time subscription for event changes
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
          // On realtime update, refetch from beginning to ensure consistency
          setOffset(0);
          fetchEvents(0, false);
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
      setOffset(0);
      fetchEvents(0, false);
    }
  }, [fetchEvents]);

  return {
    events,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    loadMore,
    refetch,
    refetchIfStale,
  };
}
