import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import type { AlumniBucket } from "@teammeet/types";
import { ALUMNI_LIMITS } from "@teammeet/core";
import * as sentry from "@/lib/analytics/sentry";

export interface SubscriptionData {
  bucket: AlumniBucket;
  alumniLimit: number | null;
  alumniCount: number;
  remaining: number | null;
  status: string;
  currentPeriodEnd: string | null;
}

interface UseSubscriptionReturn {
  subscription: SubscriptionData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useSubscription(organizationId: string | null): UseSubscriptionReturn {
  const isMountedRef = useRef(true);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    if (!organizationId) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [subRes, alumniCountRes] = await Promise.all([
        supabase.rpc("get_subscription_status", { p_org_id: organizationId }).maybeSingle(),
        supabase
          .from("user_organization_roles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("role", "alumni")
          .eq("status", "active"),
      ]);

      if (subRes.error) throw subRes.error;
      if (alumniCountRes.error) throw alumniCountRes.error;

      if (isMountedRef.current) {
        if (subRes.data) {
          const bucket = (subRes.data.alumni_bucket || "none") as AlumniBucket;
          const alumniLimit = ALUMNI_LIMITS[bucket] ?? null;
          const alumniCount = alumniCountRes.count ?? 0;

          setSubscription({
            bucket,
            alumniLimit,
            alumniCount,
            remaining: alumniLimit !== null ? Math.max(0, alumniLimit - alumniCount) : null,
            status: subRes.data.status || "active",
            currentPeriodEnd: subRes.data.current_period_end || null,
          });
        } else {
          setSubscription(null);
        }
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useSubscription.fetchSubscription" });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setSubscription(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [organizationId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchSubscription();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchSubscription]);

  // Realtime subscription for organization_subscriptions changes
  useEffect(() => {
    if (!organizationId) return;

    const channel = createPostgresChangesChannel(`subscription:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_subscriptions",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          fetchSubscription();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchSubscription]);

  // Also listen to alumni count changes (user_organization_roles with alumni role)
  useEffect(() => {
    if (!organizationId) return;

    const channel = createPostgresChangesChannel(`alumni-count:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          // Only refetch if role involves alumni (for quota updates)
          const newData = payload.new as { role?: string } | null;
          const oldData = payload.old as { role?: string } | null;
          if (newData?.role === "alumni" || oldData?.role === "alumni") {
            fetchSubscription();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchSubscription]);

  return { subscription, loading, error, refetch: fetchSubscription };
}
