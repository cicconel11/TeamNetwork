import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type { RsvpStatus } from "@teammeet/core";

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
  user_rsvp_status?: RsvpStatus | null;
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_m?: number | null;
  geofence_enabled?: boolean | null;
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
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
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
    invalidateRequests();
  }, [orgId, invalidateRequests]);

  const fetchEvents = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      const requestId = beginRequest();

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

        // RPC returns events for the org plus the caller's RSVP status and
        // total `attending` count, in one round-trip. Pagination is
        // server-side via p_limit/p_offset; pass a sentinel large limit
        // when callers opt out of pagination (`limit: 0`).
        const rpcLimit = isPaginated ? pageSize : 10_000;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: eventsError } = await (supabase as any).rpc(
          "events_with_user_rsvp",
          {
            p_org_id: orgId,
            p_limit: rpcLimit,
            p_offset: fetchOffset,
          },
        );

        if (eventsError) {
          // If function doesn't exist (yet) or table is missing, fall back
          // gracefully with an empty list rather than blocking the screen.
          const code = (eventsError as { code?: string }).code;
          if (code === "42P01" || code === "42883") {
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
        if (!isCurrentRequest(requestId)) return;

        if (isMountedRef.current && isCurrentRequest(requestId)) {
          const newData = (data as Event[]) || [];

          if (append) {
            setEvents((prev) => [...prev, ...newData]);
          } else {
            setEvents(newData);
          }

          setError(null);
          lastFetchTimeRef.current = Date.now();

          // RPC doesn't return a total count — derive `hasMore` from the
          // page fill heuristic instead.
          if (isPaginated) {
            setHasMore(newData.length === pageSize);
          }
          setTotalCount(null);

          setOffset(fetchOffset + newData.length);
        }
      } catch (e) {
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          // If table doesn't exist, don't treat as error
          const err = e as { code?: string; message: string };
          if (err.code === "42P01" || err.message?.includes("does not exist")) {
            setEvents([]);
            setError(null);
            setHasMore(false);
            setTotalCount(null);
          } else {
            const message = err.message || "An error occurred";
            setError(message);
            showToast(message, "error");
            sentry.captureException(e as Error, {
              context: "useEvents",
              orgId,
            });
          }
        }
      } finally {
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [orgId, pageSize, isPaginated, beginRequest, isCurrentRequest]
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
    const channel = createPostgresChangesChannel(`events:${orgId}`)
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
