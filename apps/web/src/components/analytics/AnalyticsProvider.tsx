"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { extractFeature, NON_ORG_PREFIXES } from "@/lib/analytics/client";
import {
  canTrackBehavioralEvent,
  getAgeBracketFromUserMetadata,
  normalizeOrgType,
  resolveTrackingLevel,
  type AgeBracket,
  type TrackingLevel,
} from "@/lib/analytics/policy";
import {
  setAnalyticsPolicy,
  trackBehavioralEvent,
  trackOpsEvent,
  getAnalyticsSessionMetadata,
  getConsentState,
  type AnalyticsPolicyChangeDetail,
} from "@/lib/analytics/events";
import { useOrgAnalytics } from "./OrgAnalyticsContext";

interface AnalyticsProviderProps {
  children: ReactNode;
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const pathname = usePathname();
  const orgAnalytics = useOrgAnalytics();
  const [authReady, setAuthReady] = useState(false);
  const [authAgeBracket, setAuthAgeBracket] = useState<AgeBracket | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [policyVersion, setPolicyVersion] = useState(0);

  const currentRouteKeyRef = useRef<string | null>(null);
  const trackedRouteKeyRef = useRef<string | null>(null);
  const trackedRouteRef = useRef<string | null>(null);
  const trackedRouteStartRef = useRef<number | null>(null);
  const trackedRouteOrgIdRef = useRef<string | null>(null);
  const trackedRouteLevelRef = useRef<TrackingLevel>("none");
  const lastAppOpenSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) return;
      setAuthUserId(user?.id ?? null);
      setAuthAgeBracket(getAgeBracketFromUserMetadata(user?.user_metadata));
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuthUserId(session?.user?.id ?? null);
      setAuthAgeBracket(getAgeBracketFromUserMetadata(session?.user?.user_metadata));
      setAuthReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePolicyChange = (event: Event) => {
      const detail = (event as CustomEvent<AnalyticsPolicyChangeDetail>).detail;
      if (!detail) return;

      if (
        detail.orgId === trackedRouteOrgIdRef.current &&
        !canTrackBehavioralEvent(detail.trackingLevel, "page_dwell_bucket")
      ) {
        trackedRouteStartRef.current = null;
        trackedRouteLevelRef.current = detail.trackingLevel;
      }

      setPolicyVersion((current) => current + 1);
    };

    window.addEventListener("analytics:policy-change", handlePolicyChange);
    return () => {
      window.removeEventListener("analytics:policy-change", handlePolicyChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncRoute() {
      const segments = pathname.replace(/^\//, "").split("/");
      const maybeSlug = segments[0];
      const isOrgRoute = !!maybeSlug && !NON_ORG_PREFIXES.has(maybeSlug);
      const orgId = isOrgRoute ? orgAnalytics?.orgId ?? null : null;
      const orgType = normalizeOrgType(orgAnalytics?.orgType);
      const routeKey = `${orgId ?? "non-org"}:${pathname}`;
      const routeChanged = currentRouteKeyRef.current !== routeKey;

      if (
        routeChanged &&
        trackedRouteRef.current &&
        trackedRouteStartRef.current &&
        trackedRouteOrgIdRef.current &&
        canTrackBehavioralEvent(trackedRouteLevelRef.current, "page_dwell_bucket")
      ) {
        const durationMs = Date.now() - trackedRouteStartRef.current;
        const previousRoute = trackedRouteRef.current;
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
        }, trackedRouteOrgIdRef.current);

        trackedRouteKeyRef.current = null;
        trackedRouteRef.current = null;
        trackedRouteStartRef.current = null;
        trackedRouteOrgIdRef.current = null;
        trackedRouteLevelRef.current = "none";
      }

      currentRouteKeyRef.current = routeKey;

      if (!isOrgRoute || !orgId) {
        return;
      }

      let consentState = getConsentState(orgId);
      const maxOptInLevel = resolveTrackingLevel(true, authAgeBracket, orgType);

      if (consentState === "unknown" && maxOptInLevel === "none") {
        setAnalyticsPolicy(orgId, "unknown", "none");
        return;
      }

      if (consentState === "unknown") {
        if (!authReady || !authUserId) {
          return;
        }

        const supabase = createClient();

        const { data, error: consentError } = await supabase
          .from("analytics_consent")
          .select("consent_state")
          .eq("org_id", orgId)
          .maybeSingle();

        if (consentError) {
          trackOpsEvent("client_error", {
            error_code: "consent_query_failed",
          });
        }

        consentState = data?.consent_state ?? "unknown";
      }

      const trackingLevel = resolveTrackingLevel(
        consentState === "opted_in",
        authAgeBracket,
        orgType,
      );
      setAnalyticsPolicy(orgId, consentState, trackingLevel);

      if (cancelled) return;

      if (!canTrackBehavioralEvent(trackingLevel, "route_view")) {
        return;
      }

      if (trackedRouteKeyRef.current === routeKey) {
        return;
      }

      const { session_id } = getAnalyticsSessionMetadata();
      if (
        session_id &&
        lastAppOpenSessionRef.current !== session_id &&
        canTrackBehavioralEvent(trackingLevel, "app_open")
      ) {
        lastAppOpenSessionRef.current = session_id;
        trackBehavioralEvent("app_open", {}, orgId);
      }

      const feature = extractFeature(pathname);
      trackBehavioralEvent("route_view", {
        screen: feature,
        feature,
      }, orgId);

      trackedRouteKeyRef.current = routeKey;
      trackedRouteRef.current = pathname;
      trackedRouteStartRef.current = canTrackBehavioralEvent(trackingLevel, "page_dwell_bucket")
        ? Date.now()
        : null;
      trackedRouteOrgIdRef.current = orgId;
      trackedRouteLevelRef.current = trackingLevel;
    }

    syncRoute();

    return () => {
      cancelled = true;
    };
  }, [authAgeBracket, authReady, authUserId, orgAnalytics, pathname, policyVersion]);

  return children;
}
