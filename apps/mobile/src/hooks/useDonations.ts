import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type { OrganizationDonation, OrganizationDonationStat } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds

interface UseDonationsReturn {
  donations: OrganizationDonation[];
  stats: OrganizationDonationStat | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

export function useDonations(orgSlug: string): UseDonationsReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [donations, setDonations] = useState<OrganizationDonation[]>([]);
  const [stats, setStats] = useState<OrganizationDonationStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when org changes
  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchDonations = useCallback(async (overrideOrgId?: string) => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setDonations([]);
        setStats(null);
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

      // Fetch donations and stats in parallel
      const [donationsResult, statsResult] = await Promise.all([
        supabase
          .from("organization_donations")
          .select("*")
          .eq("organization_id", resolvedOrgId)
          .order("created_at", { ascending: false }),
        supabase
          .from("organization_donation_stats")
          .select("*")
          .eq("organization_id", resolvedOrgId)
          .maybeSingle(),
      ]);

      if (donationsResult.error) {
        // If table doesn't exist, return empty array
        if (donationsResult.error.code === "42P01") {
          if (isMountedRef.current) {
            setDonations([]);
            setStats(null);
            setError(null);
          }
          return;
        }
        throw donationsResult.error;
      }

      if (statsResult.error && statsResult.error.code !== "PGRST116") {
        // PGRST116 = no rows returned, which is fine for stats
        if (statsResult.error.code !== "42P01") {
          throw statsResult.error;
        }
      }

      if (isMountedRef.current) {
        setDonations((donationsResult.data as OrganizationDonation[]) || []);
        setStats((statsResult.data as OrganizationDonationStat) || null);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current) {
        const error = e as { code?: string; message: string };
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          setDonations([]);
          setStats(null);
          setError(null);
        } else {
          const message = error.message || "An error occurred";
          setError(message);
          showToast(message, "error");
          sentry.captureException(e as Error, {
            context: "useDonations",
            orgSlug,
          });
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgSlug]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchDonations();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchDonations]);

  // Real-time subscription for donations table
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`donations:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_donations",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchDonations(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchDonations]);

  // Real-time subscription for donation stats table
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`donation-stats:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_donation_stats",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchDonations(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchDonations]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchDonations();
    }
  }, [fetchDonations]);

  return { donations, stats, loading, error, refetch: fetchDonations, refetchIfStale };
}
