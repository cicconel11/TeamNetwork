import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import type { Organization } from "@teammeet/types";
import * as sentry from "@/lib/analytics/sentry";

interface UseOrganizationsReturn {
  organizations: Organization[];
  pendingOrganizations: Organization[];
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
  const [pendingOrganizations, setPendingOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrganizations = useCallback(async () => {
    const requestId = beginRequest();

    try {
      if (!userId) {
        if (isMountedRef.current) {
          setOrganizations([]);
          setPendingOrganizations([]);
          setError(null); // Not an error, just not logged in
          setLoading(false);
        }
        return;
      }

      const [activeResult, pendingResult] = await Promise.all([
        supabase
          .from("user_organization_roles")
          .select("organization:organizations(*)")
          .eq("user_id", userId)
          .eq("status", "active"),
        supabase
          .from("user_organization_roles")
          .select("organization:organizations(*)")
          .eq("user_id", userId)
          .eq("status", "pending"),
      ]);

      if (activeResult.error) throw activeResult.error;
      if (pendingResult.error) throw pendingResult.error;

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        const orgs = (activeResult.data || [])
          .map((row) => row.organization)
          .filter((org): org is Organization => org !== null);
        const pendingOrgs = (pendingResult.data || [])
          .map((row) => row.organization)
          .filter((org): org is Organization => org !== null);

        setOrganizations(orgs);
        setPendingOrganizations(pendingOrgs);
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useOrganizations.fetchOrganizations" });
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setOrganizations([]);
        setError((e as Error).message);
        setPendingOrganizations([]);
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
    const channel = createPostgresChangesChannel(`organizations:${userId}`)
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

  return { organizations, pendingOrganizations, loading, error, refetch: fetchOrganizations };
}
