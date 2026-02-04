import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";

const STALE_TIME_MS = 30_000; // 30 seconds
const DEFAULT_PAGE_SIZE = 50;

export interface Alumni {
  id: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  graduation_year: number | null;
  industry: string | null;
  current_company: string | null;
  current_city: string | null;
  position_title: string | null;
  job_title: string | null;
  email: string | null;
  linkedin_url: string | null;
}

interface UseAlumniOptions {
  /** Number of records to fetch per page. Default: 50. Set to 0 to fetch all records. */
  limit?: number;
}

interface UseAlumniReturn {
  alumni: Alumni[];
  loading: boolean;
  /** True while loading more records (not initial load) */
  loadingMore: boolean;
  error: string | null;
  /** True if there are more records to fetch */
  hasMore: boolean;
  /** Total count of alumni (if available) */
  totalCount: number | null;
  /** Fetch next page of results */
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/**
 * Hook to fetch alumni for an organization with pagination support.
 * @param orgId - The organization ID (from useOrg context)
 * @param options - Pagination options (limit defaults to 50, set to 0 for all)
 */
export function useAlumni(
  orgId: string | null,
  options?: UseAlumniOptions
): UseAlumniReturn {
  const pageSize = options?.limit ?? DEFAULT_PAGE_SIZE;
  const isPaginated = pageSize > 0;

  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [alumni, setAlumni] = useState<Alumni[]>([]);
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

  const fetchAlumni = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setAlumni([]);
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
          .from("alumni")
          .select(
            `
            id,
            first_name,
            last_name,
            photo_url,
            graduation_year,
            industry,
            current_company,
            current_city,
            position_title,
            job_title,
            email,
            linkedin_url
          `,
            { count: "exact" }
          )
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .order("graduation_year", { ascending: false });

        // Apply pagination if enabled
        if (isPaginated) {
          query = query.range(fetchOffset, fetchOffset + pageSize - 1);
        }

        const { data, error: alumniError, count } = await query;

        if (alumniError) throw alumniError;

        if (isMountedRef.current) {
          const newData = (data as Alumni[]) || [];

          if (append) {
            setAlumni((prev) => [...prev, ...newData]);
          } else {
            setAlumni(newData);
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
          const message = (e as Error).message || "An error occurred";
          setError(message);
          showToast(message, "error");
          sentry.captureException(e as Error, {
            context: "useAlumni",
            orgId,
          });
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
    await fetchAlumni(offset, true);
  }, [hasMore, loadingMore, loading, offset, fetchAlumni]);

  const refetch = useCallback(async () => {
    setOffset(0);
    await fetchAlumni(0, false);
  }, [fetchAlumni]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAlumni(0, false);

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAlumni]);

  // Real-time subscription for alumni changes
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`alumni:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alumni",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          // On realtime update, refetch from beginning to ensure consistency
          setOffset(0);
          fetchAlumni(0, false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchAlumni]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      setOffset(0);
      fetchAlumni(0, false);
    }
  }, [fetchAlumni]);

  return {
    alumni,
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
