import { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from "react";
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

// Cold launch from a notification tap can race the Supabase session
// rehydration in AsyncStorage. Wait up to `timeoutMs` for the first
// non-null user emitted by onAuthStateChange or a follow-up getUser().
export async function waitForAuthUser(timeoutMs: number) {
  return new Promise<Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"]>((resolve) => {
    let settled = false;
    const finish = (user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"]) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      clearTimeout(timer);
      resolve(user);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) finish(session.user);
    });
    const timer = setTimeout(() => {
      // Last-chance retry before giving up.
      supabase.auth.getUser().then(({ data }) => finish(data?.user ?? null)).catch(() => finish(null));
    }, timeoutMs);
  });
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { orgSlug: rawOrgSlug, currentSlug } = useGlobalSearchParams<{
    orgSlug?: string;
    currentSlug?: string;
  }>();
  const orgSlug =
    (typeof rawOrgSlug === "string" && rawOrgSlug) ||
    (typeof currentSlug === "string" && currentSlug) ||
    "";
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

  const runIdRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    const runId = ++runIdRef.current;
    const isStale = () => !isMounted || runIdRef.current !== runId;

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

        if (isStale()) return;

        if (orgResult.error) {
          const nextStatus = orgResult.error.code === "PGRST116" ? "not_found" : "error";
          setStatus(nextStatus);
          setError(nextStatus === "not_found" ? null : orgResult.error.message);
          return;
        }

        // Cold-launch from a notification can land here before AsyncStorage
        // has finished rehydrating the Supabase session. getUser() momentarily
        // returns null; falling straight through to `unauthorized` would
        // bounce the user out of their deep link. Wait briefly for the
        // session to materialize before giving up.
        let currentUser = userResult.data?.user ?? null;
        if (!currentUser) {
          currentUser = await waitForAuthUser(2000);
          if (isStale()) return;
        }
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

        if (isStale()) return;

        if (roleResult.error) {
          throw roleResult.error;
        }

        if (!roleResult.data?.role) {
          setStatus("unauthorized");
          return;
        }

        // Subscription metadata is informational (controls parents bucket
        // visibility). A flaky RPC must not gate org access — fall back to
        // disabled-parents and continue.
        const subscriptionData =
          subscriptionResult.error && subscriptionResult.error.code !== "PGRST116"
            ? null
            : subscriptionResult.data;
        if (subscriptionResult.error && subscriptionResult.error.code !== "PGRST116") {
          captureException(
            new Error(subscriptionResult.error.message),
            { context: "OrgContext.get_subscription_status", orgSlug },
          );
        }
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
        if (!isStale()) {
          const message = err instanceof Error ? err.message : String(err);
          captureException(
            err instanceof Error ? err : new Error(message),
            { context: "OrgContext.fetchOrgData", orgSlug }
          );
          setStatus("error");
          setError(message);
        }
      } finally {
        if (!isStale()) {
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
