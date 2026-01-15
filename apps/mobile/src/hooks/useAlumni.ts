import { useEffect, useState, useRef } from "react";
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

interface UseAlumniReturn {
  alumni: Alumni[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAlumni(orgSlug: string): UseAlumniReturn {
  const isMountedRef = useRef(true);
  const [alumni, setAlumni] = useState<Alumni[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlumni = async () => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setAlumni([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // First get org ID from slug
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (orgError) throw orgError;
      if (!org) throw new Error("Organization not found");

      console.log("🔍 [useAlumni] Found org:", { orgSlug, orgId: org.id });

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
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .order("graduation_year", { ascending: false });

      if (alumniError) throw alumniError;

      console.log("🔍 [useAlumni] Query result:", { count: data?.length, data });

      if (isMountedRef.current) {
        setAlumni((data as Alumni[]) || []);
        setError(null);
      }
    } catch (e) {
      console.error("❌ [useAlumni] Error:", (e as Error).message);
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchAlumni();

    return () => {
      isMountedRef.current = false;
    };
  }, [orgSlug]);

  return { alumni, loading, error, refetch: fetchAlumni };
}
