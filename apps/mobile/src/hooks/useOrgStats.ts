import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";

const STALE_TIME_MS = 30_000;

export interface OrgStats {
  activeMembers: number;
  alumni: number;
  upcomingEvents: number;
  totalDonations: number;
}

interface UseOrgStatsReturn {
  stats: OrgStats;
  loading: boolean;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

const DEFAULT_STATS: OrgStats = {
  activeMembers: 0,
  alumni: 0,
  upcomingEvents: 0,
  totalDonations: 0,
};

export function useOrgStats(orgId: string | null): UseOrgStatsReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [stats, setStats] = useState<OrgStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setStats(DEFAULT_STATS);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      const now = new Date().toISOString();

      const [activeMembersResult, alumniResult, eventsResult, donationsResult] = await Promise.all([
        supabase
          .from("user_organization_roles")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "active")
          .neq("role", "alumni"),
        supabase
          .from("user_organization_roles")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "active")
          .eq("role", "alumni"),
        supabase
          .from("events")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gt("start_date", now),
        supabase
          .from("organization_donation_stats")
          .select("total_amount_cents")
          .eq("organization_id", orgId)
          .maybeSingle(),
      ]);

      if (isMountedRef.current) {
        setStats({
          activeMembers: activeMembersResult.count ?? 0,
          alumni: alumniResult.count ?? 0,
          upcomingEvents: eventsResult.count ?? 0,
          totalDonations: (donationsResult.data?.total_amount_cents ?? 0) / 100,
        });
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      // Keep existing stats on error — no toast needed for background stat fetch
      sentry.captureException(e as Error, { context: "useOrgStats", orgId });
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchStats();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchStats]);

  const refetch = useCallback(async () => {
    await fetchStats();
  }, [fetchStats]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchStats();
    }
  }, [fetchStats]);

  return {
    stats,
    loading,
    refetch,
    refetchIfStale,
  };
}
