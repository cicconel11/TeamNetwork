"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { extractFeature } from "@/lib/analytics/client";
import {
  trackBehavioralEvent,
  getAnalyticsSessionMetadata,
  getConsentState,
  setConsentState,
} from "@/lib/analytics/events";
import { useOrgAnalytics } from "./OrgAnalyticsContext";

interface AnalyticsProviderProps {
  children: ReactNode;
}

/** Non-org route prefixes that should never be treated as org slugs. */
const NON_ORG_PREFIXES = ["app", "auth", "settings", "privacy", "terms", "api"];

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const pathname = usePathname();
  const orgAnalytics = useOrgAnalytics();

  const lastRouteRef = useRef<string | null>(null);
  const lastRouteStartRef = useRef<number | null>(null);
  const lastRouteOrgIdRef = useRef<string | null>(null);
  const lastAppOpenSessionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function syncRoute() {
      const segments = pathname.replace(/^\//, "").split("/");
      const maybeSlug = segments[0];
      const isOrgRoute = !!maybeSlug && !NON_ORG_PREFIXES.includes(maybeSlug);
      const orgId = isOrgRoute ? orgAnalytics?.orgId ?? null : null;

      if (lastRouteRef.current && lastRouteStartRef.current && lastRouteOrgIdRef.current) {
        const durationMs = Date.now() - lastRouteStartRef.current;
        const previousRoute = lastRouteRef.current;
        const previousFeature = extractFeature(previousRoute);
        const dwellBucket =
          durationMs <= 5000 ? "0-5s" :
          durationMs <= 15000 ? "6-15s" :
          durationMs <= 30000 ? "16-30s" :
          durationMs <= 60000 ? "31-60s" :
          durationMs <= 180000 ? "61-180s" :
          "180s+";

        trackBehavioralEvent("page_dwell_bucket", {
          screen: previousFeature,
          feature: previousFeature,
          dwell_bucket: dwellBucket,
        }, lastRouteOrgIdRef.current);
      }

      if (!isOrgRoute || !orgId) {
        lastRouteRef.current = pathname;
        lastRouteStartRef.current = Date.now();
        lastRouteOrgIdRef.current = null;
        return;
      }

      let consentState = getConsentState(orgId);

      if (consentState === "unknown") {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled || !user) {
          lastRouteRef.current = pathname;
          lastRouteStartRef.current = Date.now();
          lastRouteOrgIdRef.current = orgId;
          return;
        }

        const { data } = await supabase
          .from("analytics_consent")
          .select("consent_state")
          .eq("org_id", orgId)
          .maybeSingle();

        consentState = data?.consent_state ?? "unknown";
        setConsentState(orgId, consentState);
      }

      if (cancelled) return;

      lastRouteRef.current = pathname;
      lastRouteStartRef.current = Date.now();
      lastRouteOrgIdRef.current = orgId;

      if (consentState !== "opted_in") {
        return;
      }

      const { session_id } = getAnalyticsSessionMetadata();
      if (session_id && lastAppOpenSessionRef.current !== session_id) {
        lastAppOpenSessionRef.current = session_id;
        trackBehavioralEvent("app_open", {}, orgId);
      }

      const feature = extractFeature(pathname);
      trackBehavioralEvent("route_view", {
        screen: feature,
        feature,
      }, orgId);
    }

    syncRoute();

    return () => {
      cancelled = true;
    };
  }, [pathname, orgAnalytics]);

  return <>{children}</>;
}
