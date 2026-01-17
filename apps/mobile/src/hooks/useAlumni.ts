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

export function useAlumni(orgSlug: string): UseAlumniReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [alumni, setAlumni] = useState<Alumni[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchAlumni = useCallback(async (overrideOrgId?: string) => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setAlumni([]);
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
        if (!org) throw new Error("Organization not found");

        resolvedOrgId = org.id;
        orgIdRef.current = resolvedOrgId;
        if (isMountedRef.current) {
          setOrgId(resolvedOrgId);
        }
      }

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
        .eq("organization_id", resolvedOrgId)
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
  }, [orgSlug]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAlumni();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAlumni]);

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
          fetchAlumni(orgId);
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
