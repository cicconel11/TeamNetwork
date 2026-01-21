import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

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

interface UseAlumniDetailReturn {
  alumni: Alumni | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAlumniDetail(orgSlug: string, alumniId: string): UseAlumniDetailReturn {
  const isMountedRef = useRef(true);
  const [alumni, setAlumni] = useState<Alumni | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlumni = useCallback(async () => {
    if (!orgSlug || !alumniId) {
      setAlumni(null);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get org ID from slug
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (orgError) throw orgError;
      if (!org) throw new Error("Organization not found");

      // Get alumni by ID
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
        .eq("id", alumniId)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .single();

      if (alumniError) throw alumniError;

      if (isMountedRef.current) {
        setAlumni(data as Alumni);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
        setAlumni(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgSlug, alumniId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAlumni();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAlumni]);

  return { alumni, loading, error, refetch: fetchAlumni };
}
