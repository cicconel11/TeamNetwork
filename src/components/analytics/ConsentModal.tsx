"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useOrgAnalytics } from "@/components/analytics/OrgAnalyticsContext";
import { setConsentState, type ConsentState } from "@/lib/analytics/events";
import { Button, Card } from "@/components/ui";

interface ConsentModalState {
  isOpen: boolean;
  consentState: ConsentState;
  loading: boolean;
  saving: boolean;
  message: string | null;
}

export function ConsentModal() {
  const orgAnalytics = useOrgAnalytics();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<ConsentModalState>({
    isOpen: false,
    consentState: "unknown",
    loading: true,
    saving: false,
    message: null,
  });

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!orgAnalytics?.orgId) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted || !user) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      const { data } = await supabase
        .from("analytics_consent")
        .select("consent_state")
        .eq("org_id", orgAnalytics.orgId)
        .maybeSingle();

      const consentState = (data?.consent_state as ConsentState) ?? "unknown";
      setConsentState(orgAnalytics.orgId, consentState);

      setState((prev) => ({
        ...prev,
        loading: false,
        consentState,
        isOpen: consentState === "unknown",
      }));
    }

    load();

    return () => {
      mounted = false;
    };
  }, [orgAnalytics?.orgId, supabase]);

  const handleDecision = useCallback(
    async (nextState: ConsentState) => {
      if (state.saving || !orgAnalytics?.orgId) return;

      setState((prev) => ({ ...prev, saving: true, message: null }));

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setState((prev) => ({ ...prev, saving: false, message: "You must be signed in." }));
          return;
        }

        const { error } = await supabase
          .from("analytics_consent")
          .upsert(
            {
              org_id: orgAnalytics.orgId,
              user_id: user.id,
              consent_state: nextState,
            },
            { onConflict: "org_id,user_id" },
          );

        if (error) {
          setState((prev) => ({
            ...prev,
            saving: false,
            message: error.message || "Failed to update preference",
          }));
          return;
        }

        setConsentState(orgAnalytics.orgId, nextState);

        setState((prev) => ({
          ...prev,
          saving: false,
          consentState: nextState,
          isOpen: false,
        }));
      } catch {
        setState((prev) => ({
          ...prev,
          saving: false,
          message: "Network error. Please try again.",
        }));
      }
    },
    [state.saving, orgAnalytics?.orgId, supabase],
  );

  if (state.loading || !state.isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-xl p-6 space-y-4" role="dialog" aria-modal="true">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Help us improve TeamNetwork</h2>
          <p className="text-sm text-muted-foreground mt-2">
            With your explicit permission, we collect privacy-first usage analytics to personalize your
            experience. This is optional and disabled by default to stay COPPA and FERPA compliant.
          </p>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          We never log message content, form answers, or donation details tied to a person. We only store
          anonymized usage patterns like page views and feature interactions.
        </div>

        {state.message && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground">
            Read our privacy policy
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={state.saving}
              onClick={() => handleDecision("opted_out")}
            >
              Decline
            </Button>
            <Button
              size="sm"
              disabled={state.saving}
              onClick={() => handleDecision("opted_in")}
            >
              Accept
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
