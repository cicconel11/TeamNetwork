import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STALE_TIME_MS = 30_000;
const DEFAULT_PAGE_SIZE = 50;

export interface DirectoryMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  graduation_year: number | null;
  role: string | null;
  linkedin_url: string | null;
}

interface UseMemberDirectoryOptions {
  /** Number of records to fetch per page. Default: 50. Set to 0 to fetch all records. */
  limit?: number;
}

interface UseMemberDirectoryReturn {
  members: DirectoryMember[];
  loading: boolean;
  /** True while loading more records (not initial load) */
  loadingMore: boolean;
  error: string | null;
  /** True if there are more records to fetch */
  hasMore: boolean;
  /** Total count of members (if available) */
  totalCount: number | null;
  /** Fetch next page of results */
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/**
 * Hook to fetch member directory for an organization with pagination support.
 * @param orgId - The organization ID (from useOrg context)
 * @param options - Pagination options (limit defaults to 50, set to 0 for all)
 */
export function useMemberDirectory(
  orgId: string | null,
  options?: UseMemberDirectoryOptions
): UseMemberDirectoryReturn {
  const pageSize = options?.limit ?? DEFAULT_PAGE_SIZE;
  const isPaginated = pageSize > 0;

  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
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

  const fetchMembers = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setMembers([]);
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

        let query = supabase
          .from("members")
          .select(
            `
            id,
            first_name,
            last_name,
            email,
            photo_url,
            graduation_year,
            role,
            linkedin_url
          `,
            { count: "exact" }
          )
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .eq("status", "active")
          .order("last_name", { ascending: true });

        // Apply pagination if enabled
        if (isPaginated) {
          query = query.range(fetchOffset, fetchOffset + pageSize - 1);
        }

        const { data, error: membersError, count } = await query;

        if (membersError) throw membersError;

        if (isMountedRef.current) {
          const newData = (data as DirectoryMember[]) || [];

          if (append) {
            setMembers((prev) => [...prev, ...newData]);
          } else {
            setMembers(newData);
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
          setError((e as Error).message);
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
    await fetchMembers(offset, true);
  }, [hasMore, loadingMore, loading, offset, fetchMembers]);

  const refetch = useCallback(async () => {
    setOffset(0);
    await fetchMembers(0, false);
  }, [fetchMembers]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchMembers(0, false);

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchMembers]);

  // Real-time subscription for member changes
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`member-directory:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "members",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          // On realtime update, refetch from beginning to ensure consistency
          setOffset(0);
          fetchMembers(0, false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchMembers]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      setOffset(0);
      fetchMembers(0, false);
    }
  }, [fetchMembers]);

  return {
    members,
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
