import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Organization } from "@teammeet/types";

// #region agent log
const DEBUG_ENDPOINT = "http://127.0.0.1:7242/ingest/0eaba42a-4b1e-479c-bf2c-aacdd15d55fa";
const debugLog = (location: string, message: string, data: Record<string, unknown>, hypothesisId: string) => {
  fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location, message, data, hypothesisId, timestamp: Date.now(), sessionId: "debug-session" }) }).catch(() => {});
};
// #endregion

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
      console.log("DEBUG: useOrganizations - Starting fetch...");

      // #region agent log
      debugLog("useOrganizations.ts:fetchOrganizations:entry", "Starting org fetch", {}, "A");
      // #endregion

      // First check if we have a session (don't throw if missing)
      const { data: sessionData } = await supabase.auth.getSession();
      
      // #region agent log
      debugLog("useOrganizations.ts:fetchOrganizations:session", "Session check result", {
        hasSession: !!sessionData?.session,
        hasUser: !!sessionData?.session?.user,
        userId: sessionData?.session?.user?.id ?? null,
        userEmail: sessionData?.session?.user?.email ?? null,
      }, "A");
      // #endregion
      
      if (!sessionData?.session?.user) {
        console.log("DEBUG: useOrganizations - No session, skipping fetch");
        // #region agent log
        debugLog("useOrganizations.ts:fetchOrganizations:noSession", "No session - returning empty", {}, "A");
        // #endregion
        if (isMountedRef.current) {
          setOrganizations([]);
          setError(null); // Not an error, just not logged in
          setLoading(false);
        }
        return;
      }

      const user = sessionData.session.user;
      console.log("DEBUG: useOrganizations - User found:", {
        userId: user.id,
        email: user.email,
      });

      // First, check ALL memberships (regardless of status) - Hypothesis B, C
      const { data: allMemberships, error: allMembershipsError } = await supabase
        .from("user_organization_roles")
        .select("organization_id, role, status")
        .eq("user_id", user.id);

      // #region agent log
      debugLog("useOrganizations.ts:fetchOrganizations:allMemberships", "All memberships for user (any status)", {
        userId: user.id,
        count: allMemberships?.length ?? 0,
        memberships: allMemberships ?? [],
        error: allMembershipsError?.message ?? null,
      }, "B,C");
      // #endregion

      const { data, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select("organization:organizations(*)")
        .eq("user_id", user.id)
        .eq("status", "active");

      console.log("DEBUG: useOrganizations - Query result:", {
        dataLength: data?.length,
        fetchError: fetchError?.message,
        firstItem: data?.[0],
      });

      // #region agent log
      debugLog("useOrganizations.ts:fetchOrganizations:activeQuery", "Active memberships with org embed", {
        userId: user.id,
        rowCount: data?.length ?? 0,
        rawData: data ?? [],
        nullOrgCount: (data ?? []).filter(r => r.organization === null).length,
        error: fetchError?.message ?? null,
      }, "B,C,D");
      // #endregion

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        const orgs = (data || [])
          .map((row) => row.organization)
          .filter((org): org is Organization => org !== null);

        console.log("DEBUG: useOrganizations - Filtered orgs count:", orgs.length);

        // #region agent log
        debugLog("useOrganizations.ts:fetchOrganizations:filtered", "Filtered orgs (non-null)", {
          filteredCount: orgs.length,
          orgNames: orgs.map(o => o.name),
        }, "D");
        // #endregion

        setOrganizations(orgs);
        setError(null);
      }
    } catch (e) {
      console.error("DEBUG: useOrganizations - Error:", e);
      // #region agent log
      debugLog("useOrganizations.ts:fetchOrganizations:error", "Fetch error", { error: (e as Error).message }, "A,B,C,D");
      // #endregion
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("DEBUG: useOrganizations - Auth state changed:", { event, hasSession: !!session });
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
