import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import { filterAnnouncementsForUser, ViewerContext } from "@teammeet/core";
import { normalizeRole } from "@teammeet/core";
import type { Announcement } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds
const DEFAULT_PAGE_SIZE = 50;

interface UseAnnouncementsOptions {
  /** Number of records to fetch per page. Default: 50. Set to 0 to fetch all records. */
  limit?: number;
}

interface UseAnnouncementsReturn {
  announcements: Announcement[];
  loading: boolean;
  /** True while loading more records (not initial load) */
  loadingMore: boolean;
  error: string | null;
  /** True if there are more records to fetch */
  hasMore: boolean;
  /** Total count of announcements (if available, before audience filtering) */
  totalCount: number | null;
  /** Fetch next page of results */
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/**
 * Hook to fetch announcements for an organization with pagination support.
 * Note: Audience filtering is applied client-side, so totalCount reflects
 * all announcements before filtering. hasMore may be inaccurate if many
 * announcements are filtered out.
 * @param orgId - The organization ID (from useOrg context)
 * @param options - Pagination options (limit defaults to 50, set to 0 for all)
 */
export function useAnnouncements(
  orgId: string | null,
  options?: UseAnnouncementsOptions
): UseAnnouncementsReturn {
  const pageSize = options?.limit ?? DEFAULT_PAGE_SIZE;
  const isPaginated = pageSize > 0;

  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  // Store viewer context for filtering across pages
  const viewerContextRef = useRef<ViewerContext | null>(null);

  useEffect(() => {
    lastFetchTimeRef.current = 0;
    setOffset(0);
    setHasMore(false);
    setTotalCount(null);
    viewerContextRef.current = null;
  }, [orgId]);

  const fetchAnnouncements = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setAnnouncements([]);
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

        // Get current user
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        if (isMountedRef.current) {
          setUserId(user.id);
        }

        // Get user's role in this org (only on initial fetch or if not cached)
        if (!viewerContextRef.current || !append) {
          const { data: roleData } = await supabase
            .from("user_organization_roles")
            .select("role, status")
            .eq("organization_id", orgId)
            .eq("user_id", user.id)
            .eq("status", "active")
            .single();

          viewerContextRef.current = {
            role: normalizeRole(roleData?.role),
            status: roleData?.status ?? null,
            userId: user.id,
          };
        }

        // Build query
        let query = supabase
          .from("announcements")
          .select("*", { count: "exact" })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        // Apply pagination if enabled
        if (isPaginated) {
          query = query.range(fetchOffset, fetchOffset + pageSize - 1);
        }

        const { data: announcementsData, error: announcementsError, count } = await query;

        if (announcementsError) throw announcementsError;

        // Filter based on audience targeting
        const filtered = filterAnnouncementsForUser(
          announcementsData || [],
          viewerContextRef.current
        );

        if (isMountedRef.current) {
          if (append) {
            setAnnouncements((prev) => [...prev, ...filtered]);
          } else {
            setAnnouncements(filtered);
          }

          setError(null);
          lastFetchTimeRef.current = Date.now();

          if (count !== null) {
            setTotalCount(count);
            if (isPaginated) {
              // Note: hasMore is based on DB count, not filtered count
              setHasMore(fetchOffset + (announcementsData?.length || 0) < count);
            }
          } else if (isPaginated) {
            // Fallback: check if we got a full page
            setHasMore((announcementsData?.length || 0) === pageSize);
          }

          setOffset(fetchOffset + (announcementsData?.length || 0));
        }
      } catch (e) {
        if (isMountedRef.current) {
          const message = (e as Error).message || "An error occurred";
          setError(message);
          showToast(message, "error");
          sentry.captureException(e as Error, {
            context: "useAnnouncements",
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
    await fetchAnnouncements(offset, true);
  }, [hasMore, loadingMore, loading, offset, fetchAnnouncements]);

  const refetch = useCallback(async () => {
    setOffset(0);
    viewerContextRef.current = null;
    await fetchAnnouncements(0, false);
  }, [fetchAnnouncements]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAnnouncements(0, false);

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAnnouncements]);

  // Real-time subscription for announcement changes
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`announcements:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcements",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          // On realtime update, refetch from beginning to ensure consistency
          setOffset(0);
          viewerContextRef.current = null;
          fetchAnnouncements(0, false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchAnnouncements]);

  // Re-fetch announcements if user's role changes (affects audience filtering)
  useEffect(() => {
    if (!orgId || !userId) return;
    const channel = supabase
      .channel(`announcement-roles:${orgId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextOrgId = (payload.new as { organization_id?: string } | null)
            ?.organization_id;
          const previousOrgId = (payload.old as { organization_id?: string } | null)
            ?.organization_id;
          if (nextOrgId === orgId || previousOrgId === orgId) {
            setOffset(0);
            viewerContextRef.current = null;
            fetchAnnouncements(0, false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, fetchAnnouncements]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      setOffset(0);
      viewerContextRef.current = null;
      fetchAnnouncements(0, false);
    }
  }, [fetchAnnouncements]);

  return {
    announcements,
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
