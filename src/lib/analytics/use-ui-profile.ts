"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getLastConsentState } from "./client";
import type { UIProfile } from "./types";

const CACHE_KEY_PREFIX = "tn_ui_profile_";

/**
 * React hook for consuming LLM-generated UI profiles.
 *
 * Fetches from /api/analytics/profile on mount (single API call).
 * The profile endpoint returns a `consented` field — if false,
 * the cached profile is cleared and null is returned.
 *
 * Caches in sessionStorage scoped to user+org to prevent cross-user leaks.
 * Returns null if user hasn't consented (graceful degradation).
 *
 * Listens for `analytics:consent-change` events dispatched by ConsentBanner
 * so that cached profiles are cleared immediately on consent revocation.
 */
export function useUIProfile(orgId: string | undefined): {
  profile: UIProfile | null;
  loading: boolean;
} {
  const [profile, setProfile] = useState<UIProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen for consent revocation to clear cached profile immediately
  useEffect(() => {
    function onConsentChange(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.consented === false) {
        setProfile(null);
        // Clear all profile caches from sessionStorage
        try {
          for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key?.startsWith(CACHE_KEY_PREFIX)) {
              sessionStorage.removeItem(key);
            }
          }
        } catch { /**/ }
      }
    }

    window.addEventListener("analytics:consent-change", onConsentChange);
    return () => window.removeEventListener("analytics:consent-change", onConsentChange);
  }, []);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      // Get current user for cache scoping
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        setLoading(false);
        return;
      }

      const cacheKey = `${CACHE_KEY_PREFIX}${user.id}_${orgId}`;

      // Check consent BEFORE using cache — if revoked, clear and bail
      const { consented } = getLastConsentState();
      if (!consented) {
        try { sessionStorage.removeItem(cacheKey); } catch { /**/ }
        setProfile(null);
        setLoading(false);
        return;
      }

      // Try sessionStorage cache (now safe — consent is verified)
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as UIProfile;
          if (parsed.nav_order && parsed.nav_order.length > 0) {
            setProfile(parsed);
            setLoading(false);
            return;
          }
        }
      } catch {
        // sessionStorage may be unavailable
      }

      // Fetch from API — single call returns profile + consent status
      try {
        const response = await fetch(`/api/analytics/profile?orgId=${orgId}`);
        if (!response.ok || cancelled) {
          setLoading(false);
          return;
        }

        const data = await response.json();
        if (cancelled) return;

        // If consent is revoked, clear stale cache
        if (data.consented === false) {
          try { sessionStorage.removeItem(cacheKey); } catch { /**/ }
          setProfile(null);
          setLoading(false);
          return;
        }

        const p = data.profile as UIProfile | null;
        setProfile(p);

        // Cache in sessionStorage
        if (p && p.nav_order && p.nav_order.length > 0) {
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(p));
          } catch {
            // Ignore storage errors
          }
        }
      } catch {
        // Network error — graceful degradation
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { profile, loading };
}
