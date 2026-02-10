"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  initAnalytics,
  setAnalyticsContext,
  setOrgContext,
  handleRouteChange,
  flushFeatureExit,
  getLastConsentState,
} from "@/lib/analytics/client";
import { useOrgAnalytics } from "./OrgAnalyticsContext";
import type { AgeBracket, OrgType } from "@/lib/analytics/types";

interface AnalyticsProviderProps {
  children: ReactNode;
}

/** Non-org route prefixes that should never be treated as org slugs. */
const NON_ORG_PREFIXES = ["app", "auth", "settings", "privacy", "terms", "api"];

/**
 * Global analytics provider.
 *
 * Mirrors the ErrorBoundaryProvider pattern:
 *  - Initializes client-side tracking in useEffect
 *  - Listens for auth state changes to update context
 *  - Tracks route changes via usePathname()
 *
 * Org context is provided by OrgAnalyticsProvider (rendered in
 * [orgSlug]/layout.tsx) which eliminates the per-navigation DB query
 * that was previously needed to resolve slug → orgId + orgType.
 */
export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const pathname = usePathname();
  const orgAnalytics = useOrgAnalytics();

  // Refs to share consent/ageBracket between the two effects without
  // creating a dependency loop.
  const consentedRef = useRef(false);
  const ageBracketRef = useRef<AgeBracket>("18_plus");

  // Effect #1: Initialize analytics, fetch consent, listen for auth changes.
  // Runs once on mount.
  useEffect(() => {
    initAnalytics();

    const supabase = createClient();

    async function loadUserContext() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        consentedRef.current = false;
        setAnalyticsContext(false, null, null);
        return;
      }

      const ageBracket = (user.user_metadata?.age_bracket as AgeBracket) ?? "18_plus";
      ageBracketRef.current = ageBracket;

      // Check consent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: consent } = await (supabase as any)
        .from("analytics_consent")
        .select("consented")
        .eq("user_id", user.id)
        .maybeSingle();

      const consented = consent?.consented === true;
      consentedRef.current = consented;

      // Set context without org (org effect handles that separately)
      setAnalyticsContext(consented, ageBracket, null);
    }

    loadUserContext();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUserContext();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Effect #2: Re-derive org context whenever the pathname or org context changes,
  // then track the route change once context is settled.
  //
  // Uses getLastConsentState() instead of consentedRef so that consent
  // changes made by ConsentBanner (via setAnalyticsContext) are immediately
  // reflected without waiting for an auth state change or reload.
  //
  // OrgAnalyticsContext (from [orgSlug]/layout.tsx) provides orgId + orgType
  // synchronously, eliminating the per-navigation DB query.
  useEffect(() => {
    const segments = pathname.replace(/^\//, "").split("/");
    const maybeSlug = segments[0];

    if (!maybeSlug || maybeSlug === "" || NON_ORG_PREFIXES.includes(maybeSlug)) {
      // Emit exit event for the previous page under its original org context
      // before clearing org state for the new (non-org) route.
      flushFeatureExit();
      setOrgContext(undefined);
      const { consented, ageBracket } = getLastConsentState();
      setAnalyticsContext(consented, ageBracket, null);
      handleRouteChange(pathname);
      return;
    }

    // Emit exit event for the previous page under its original org context
    // before updating to the new context.
    flushFeatureExit();

    const { consented, ageBracket } = getLastConsentState();

    if (orgAnalytics) {
      // Use org context provided by OrgAnalyticsProvider (no DB query)
      setOrgContext(orgAnalytics.orgId);
      setAnalyticsContext(
        consented,
        ageBracket,
        (orgAnalytics.orgType as OrgType) ?? "general",
      );
    } else {
      // Org route but OrgAnalyticsProvider hasn't mounted yet — defer
      // until orgAnalytics populates (the dep array will re-fire this effect).
      return;
    }

    // Track route change — org context is already set synchronously
    handleRouteChange(pathname);
  }, [pathname, orgAnalytics]);

  return <>{children}</>;
}
