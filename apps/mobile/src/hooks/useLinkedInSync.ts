import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";

export type LinkedInEnrichmentStatus = "pending" | "syncing" | "enriched" | "failed";

export interface LinkedInSyncStatus {
  linkedInUrl: string | null;
  enrichmentStatus: LinkedInEnrichmentStatus | null;
  lastSyncAt: string | null;
  syncError: string | null;
  enrichmentConfigured: boolean;
  resyncEnabled: boolean;
  resyncIsAdmin: boolean;
  resyncRemaining: number;
  resyncMaxPerMonth: number;
}

interface StatusResponse {
  linkedin_url: string | null;
  connection: {
    lastSyncAt: string | null;
    syncError: string | null;
    enrichmentStatus: LinkedInEnrichmentStatus | null;
  } | null;
  integration?: { enrichmentConfigured?: boolean };
  resync?: { enabled: boolean; is_admin: boolean; remaining: number; max_per_month: number };
}

export interface UseLinkedInSyncReturn {
  status: LinkedInSyncStatus | null;
  loading: boolean;
  error: string | null;
  syncing: boolean;
  refetch: () => Promise<void>;
  sync: () => Promise<{ message: string }>;
}

const POLL_INTERVAL_MS = 8000;

/**
 * Mobile LinkedIn self-sync. Reads the user's enrichment status from the web
 * API (Bearer auth) and starts an async Apify run. While a run is in flight
 * (`enrichmentStatus === "syncing"`) it polls until the status settles.
 */
export function useLinkedInSync(): UseLinkedInSyncReturn {
  const isMountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<LinkedInSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/user/linkedin/status");
      if (res.status === 401) {
        if (isMountedRef.current) setError(null);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      if (!isMountedRef.current) return;
      setStatus({
        linkedInUrl: data.linkedin_url ?? null,
        enrichmentStatus: data.connection?.enrichmentStatus ?? null,
        lastSyncAt: data.connection?.lastSyncAt ?? null,
        syncError: data.connection?.syncError ?? null,
        enrichmentConfigured: data.integration?.enrichmentConfigured ?? false,
        resyncEnabled: data.resync?.enabled ?? false,
        resyncIsAdmin: data.resync?.is_admin ?? false,
        resyncRemaining: data.resync?.remaining ?? 0,
        resyncMaxPerMonth: data.resync?.max_per_month ?? 0,
      });
      setError(null);
    } catch (e) {
      sentry.captureException(e as Error, { context: "useLinkedInSync.refetch" });
      if (isMountedRef.current) setError((e as Error).message);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  const sync = useCallback(async () => {
    const res = await fetchWithAuth("/api/user/linkedin/enrichment-sync", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await refetch();
      throw new Error((data as { error?: string }).error ?? "Failed to start LinkedIn sync");
    }
    await refetch();
    return { message: (data as { message?: string }).message ?? "LinkedIn sync started" };
  }, [refetch]);

  // Initial load.
  useEffect(() => {
    isMountedRef.current = true;
    setLoading(true);
    void refetch();
    return () => {
      isMountedRef.current = false;
    };
  }, [refetch]);

  // Poll while a run is in flight so the badge flips to enriched/failed on its own.
  useEffect(() => {
    const inFlight = status?.enrichmentStatus === "syncing" || status?.enrichmentStatus === "pending";
    setSyncing(inFlight);
    if (inFlight && !pollRef.current) {
      pollRef.current = setInterval(() => {
        void refetch();
      }, POLL_INTERVAL_MS);
    } else if (!inFlight && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.enrichmentStatus, refetch]);

  return { status, loading, error, syncing, refetch, sync };
}
