import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STALE_TIME_MS = 30_000; // 30 seconds

interface Alumni {
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

interface UseAlumniReturn {
  alumni: Alumni[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/**
 * Hook to fetch alumni for an organization.
 * @param orgId - The organization ID (from useOrg context)
 */
export function useAlumni(orgId: string | null): UseAlumniReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [alumni, setAlumni] = useState<Alumni[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    lastFetchTimeRef.current = 0;
  }, [orgId]);

  const fetchAlumni = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setAlumni([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // Get alumni for this organization
      const { data, error: alumniError } = await supabase
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
        `
        )
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("graduation_year", { ascending: false });

      if (alumniError) throw alumniError;

      if (isMountedRef.current) {
        setAlumni((data as Alumni[]) || []);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAlumni();

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
          fetchAlumni();
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
      fetchAlumni();
    }
  }, [fetchAlumni]);

  return { alumni, loading, error, refetch: fetchAlumni, refetchIfStale };
}
