import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import type { Organization } from "@teammeet/types";
import * as sentry from "@/lib/analytics/sentry";

interface UseOrganizationsReturn {
  organizations: Organization[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOrganizations(): UseOrganizationsReturn {
  const isMountedRef = useRef(true);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrganizations = useCallback(async () => {
    const requestId = beginRequest();

    try {
      if (!userId) {
        if (isMountedRef.current) {
          setOrganizations([]);
          setError(null); // Not an error, just not logged in
          setLoading(false);
        }
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select("organization:organizations(*)")
        .eq("user_id", userId)
        .eq("status", "active");

      if (fetchError) throw fetchError;

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        const orgs = (data || [])
          .map((row) => row.organization)
          .filter((org): org is Organization => org !== null);

        setOrganizations(orgs);
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useOrganizations.fetchOrganizations" });
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [userId, beginRequest, isCurrentRequest]);

  useEffect(() => {
    isMountedRef.current = true;
    invalidateRequests();
    fetchOrganizations();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchOrganizations, invalidateRequests]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`organizations:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchOrganizations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchOrganizations]);

  return { organizations, loading, error, refetch: fetchOrganizations };
}
