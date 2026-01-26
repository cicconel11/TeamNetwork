import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useGlobalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { setUserProperties } from "@/lib/analytics";
import { normalizeRole, type OrgRole } from "@teammeet/core";

export type AnalyticsRole = "admin" | "member" | "alumni" | "unknown";
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
  userRole: NormalizedRole;
  isLoading: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { orgSlug } = useGlobalSearchParams<{ orgSlug: string }>();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
  const [orgPrimaryColor, setOrgPrimaryColor] = useState<string | null>(null);
  const [orgSecondaryColor, setOrgSecondaryColor] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<NormalizedRole>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function fetchOrgData() {
      if (!orgSlug) {
        setIsLoading(false);
        return;
      }

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

      const fetchedOrgId = orgResult.data?.id ?? null;
      const fetchedOrgName = orgResult.data?.name ?? null;
      const fetchedOrgLogoUrl = orgResult.data?.logo_url ?? null;
      const fetchedPrimaryColor = orgResult.data?.primary_color ?? null;
      const fetchedSecondaryColor = orgResult.data?.secondary_color ?? null;

      setOrgId(fetchedOrgId);
      setOrgName(fetchedOrgName);
      setOrgLogoUrl(fetchedOrgLogoUrl);
      setOrgPrimaryColor(fetchedPrimaryColor);
      setOrgSecondaryColor(fetchedSecondaryColor);

      // Fetch user's role if we have both org and user
      if (fetchedOrgId && userResult.data?.user?.id) {
        const { data: roleData } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("organization_id", fetchedOrgId)
          .eq("user_id", userResult.data.user.id)
          .eq("status", "active")
          .single();

        if (isMounted && roleData?.role) {
          const normalized = normalizeRole(roleData.role);
          setUserRole(normalized);
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    }

    setIsLoading(true);
    setUserRole(null);
    setOrgId(null);
    setOrgName(null);
    setOrgLogoUrl(null);
    setOrgPrimaryColor(null);
    setOrgSecondaryColor(null);
    fetchOrgData();

    return () => {
      isMounted = false;
    };
  }, [orgSlug]);

  // Set analytics user properties when org context changes
  useEffect(() => {
    if (isLoading || !orgSlug || !orgId) return;

    setUserProperties({
      currentOrgSlug: orgSlug,
      currentOrgId: orgId,
      role: toAnalyticsRole(userRole),
    });
  }, [orgSlug, orgId, userRole, isLoading]);

  return (
    <OrgContext.Provider
      value={{
        orgSlug: orgSlug ?? "",
        orgId,
        orgName,
        orgLogoUrl,
        orgPrimaryColor,
        orgSecondaryColor,
        userRole,
        isLoading,
      }}
    >
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
