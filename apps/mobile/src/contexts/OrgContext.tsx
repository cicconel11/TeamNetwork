import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useGlobalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { setUserProperties, captureException } from "@/lib/analytics";
import { normalizeRole, type OrgRole } from "@teammeet/core";

export type AnalyticsRole = "admin" | "member" | "alumni" | "parent" | "unknown";
export type OrgAccessStatus =
  | "loading"
  | "ready"
  | "not_found"
  | "unauthorized"
  | "error";
// Normalized roles after applying normalizeRole()
type NormalizedRole = OrgRole | null;

export function toAnalyticsRole(role: OrgRole | null): AnalyticsRole {
  if (!role) return "unknown";
  if (role === "active_member") return "member";
  return role;
}

interface OrgContextValue {
  orgSlug: string;
  orgId: string | null;
  orgName: string | null;
  orgLogoUrl: string | null;
  orgPrimaryColor: string | null;
  orgSecondaryColor: string | null;
  hasParentsAccess: boolean;
  userRole: NormalizedRole;
  status: OrgAccessStatus;
  isLoading: boolean;
  error: string | null;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { orgSlug } = useGlobalSearchParams<{ orgSlug: string }>();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
  const [orgPrimaryColor, setOrgPrimaryColor] = useState<string | null>(null);
  const [orgSecondaryColor, setOrgSecondaryColor] = useState<string | null>(null);
  const [hasParentsAccess, setHasParentsAccess] = useState(false);
  const [userRole, setUserRole] = useState<NormalizedRole>(null);
  const [status, setStatus] = useState<OrgAccessStatus>("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchOrgData() {
      if (!orgSlug) {
        setStatus("ready");
        setIsLoading(false);
        return;
      }

      try {
        // Fetch org and user's membership in parallel
        const [orgResult, userResult] = await Promise.all([
          supabase
            .from("organizations")
            .select("id, name, logo_url, primary_color, secondary_color")
            .eq("slug", orgSlug)
            .single(),
          supabase.auth.getUser(),
        ]);

        if (!isMounted) return;

        if (orgResult.error) {
          const nextStatus = orgResult.error.code === "PGRST116" ? "not_found" : "error";
          setStatus(nextStatus);
          setError(nextStatus === "not_found" ? null : orgResult.error.message);
          return;
        }

        const currentUser = userResult.data?.user;
        if (!currentUser) {
          setStatus("unauthorized");
          return;
        }

        const fetchedOrgId = orgResult.data?.id ?? null;
        if (!fetchedOrgId) {
          setStatus("not_found");
          return;
        }

        const [roleResult, subscriptionResult] = await Promise.all([
          supabase
            .from("user_organization_roles")
            .select("role")
            .eq("organization_id", fetchedOrgId)
            .eq("user_id", currentUser.id)
            .eq("status", "active")
            .maybeSingle(),
          supabase
            .rpc("get_subscription_status", { p_org_id: fetchedOrgId })
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        if (roleResult.error) {
          throw roleResult.error;
        }

        if (subscriptionResult.error && subscriptionResult.error.code !== "PGRST116") {
          throw subscriptionResult.error;
        }

        if (!roleResult.data?.role) {
          setStatus("unauthorized");
          return;
        }

        const subscriptionData = subscriptionResult.data;
        const parentsEnabled =
          subscriptionData?.status === "enterprise_managed" ||
          (subscriptionData?.parents_bucket != null && subscriptionData.parents_bucket !== "none");

        setOrgId(fetchedOrgId);
        setOrgName(orgResult.data.name ?? null);
        setOrgLogoUrl(orgResult.data.logo_url ?? null);
        setOrgPrimaryColor(orgResult.data.primary_color ?? null);
        setOrgSecondaryColor(orgResult.data.secondary_color ?? null);
        setHasParentsAccess(parentsEnabled);
        setUserRole(normalizeRole(roleResult.data.role));
        setStatus("ready");
      } catch (err) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : String(err);
          captureException(
            err instanceof Error ? err : new Error(message),
            { context: "OrgContext.fetchOrgData", orgSlug }
          );
          setStatus("error");
          setError(message);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    setIsLoading(true);
    setError(null);
    setUserRole(null);
    setStatus(orgSlug ? "loading" : "ready");
    setOrgId(null);
    setOrgName(null);
    setOrgLogoUrl(null);
    setOrgPrimaryColor(null);
    setOrgSecondaryColor(null);
    setHasParentsAccess(false);
    fetchOrgData();

    return () => {
      isMounted = false;
    };
  }, [orgSlug]);

  // Set analytics user properties when org context changes
  useEffect(() => {
    if (isLoading || status !== "ready" || !orgSlug || !orgId) return;

    setUserProperties({
      currentOrgSlug: orgSlug,
      currentOrgId: orgId,
      role: toAnalyticsRole(userRole),
    });
  }, [orgSlug, orgId, userRole, isLoading, status]);

  const value = useMemo<OrgContextValue>(() => ({
    orgSlug: orgSlug ?? "",
    orgId,
    orgName,
    orgLogoUrl,
    orgPrimaryColor,
    orgSecondaryColor,
    hasParentsAccess,
    userRole,
    status,
    isLoading,
    error,
  }), [orgSlug, orgId, orgName, orgLogoUrl, orgPrimaryColor, orgSecondaryColor, hasParentsAccess, userRole, status, isLoading, error]);

  return (
    <OrgContext.Provider value={value}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within an OrgProvider");
  }
  return context;
}
