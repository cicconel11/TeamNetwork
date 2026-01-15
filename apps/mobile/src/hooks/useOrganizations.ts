import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Organization } from "@teammeet/types";

interface UseOrganizationsReturn {
  organizations: Organization[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOrganizations(): UseOrganizationsReturn {
  const isMountedRef = useRef(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrganizations = useCallback(async () => {
    try {
      // First check if we have a session (don't throw if missing)
      const { data: sessionData } = await supabase.auth.getSession();

      if (!sessionData?.session?.user) {
        if (isMountedRef.current) {
          setOrganizations([]);
          setError(null); // Not an error, just not logged in
          setLoading(false);
        }
        return;
      }

      const user = sessionData.session.user;

      const { data, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select("organization:organizations(*)")
        .eq("user_id", user.id)
        .eq("status", "active");

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        const orgs = (data || [])
          .map((row) => row.organization)
          .filter((org): org is Organization => org !== null);

        setOrganizations(orgs);
        setError(null);
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
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchOrganizations();

    // Listen for auth state changes and refetch when user signs in
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, _session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        fetchOrganizations();
      } else if (event === "SIGNED_OUT") {
        if (isMountedRef.current) {
          setOrganizations([]);
          setError(null);
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, [fetchOrganizations]);

  return { organizations, loading, error, refetch: fetchOrganizations };
}
