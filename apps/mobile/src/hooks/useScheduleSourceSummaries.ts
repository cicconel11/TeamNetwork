import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";

export type ScheduleSourceStatus = "active" | "paused" | "error";

export interface ScheduleSourceSummary {
  id: string;
  vendor_id: "ics" | "vendorA" | "vendorB" | "generic_html" | "google_calendar";
  maskedUrl: string;
  status: ScheduleSourceStatus;
  last_synced_at: string | null;
  last_error: string | null;
  title: string | null;
  last_event_count: number | null;
  last_imported: number | null;
}

interface UseScheduleSourceSummariesReturn {
  sources: ScheduleSourceSummary[];
  loading: boolean;
  syncingSourceId: string | null;
  togglingSourceId: string | null;
  removingSourceId: string | null;
  error: string | null;
  notice: string | null;
  refetch: () => Promise<void>;
  syncSource: (sourceId: string) => Promise<{ success: boolean; error?: string }>;
  toggleSourceStatus: (
    source: ScheduleSourceSummary
  ) => Promise<{ success: boolean; error?: string }>;
  removeSource: (sourceId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useScheduleSourceSummaries(
  orgId: string | null,
  isAdmin: boolean
): UseScheduleSourceSummariesReturn {
  const isMountedRef = useRef(true);
  const [sources, setSources] = useState<ScheduleSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [togglingSourceId, setTogglingSourceId] = useState<string | null>(null);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId || !isAdmin) {
      if (isMountedRef.current) {
        setSources([]);
        setError(null);
        setNotice(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetchWithAuth(
        `/api/schedules/sources?orgId=${encodeURIComponent(orgId)}`,
        { method: "GET" }
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Failed to load schedule sources.");
      }

      if (isMountedRef.current) {
        setSources(Array.isArray(data?.sources) ? data.sources : []);
      }
    } catch (e) {
      sentry.captureException(e as Error, {
        context: "useScheduleSourceSummaries.refetch",
        orgId: orgId ?? undefined,
      });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setSources([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [isAdmin, orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    refetch();

    return () => {
      isMountedRef.current = false;
    };
  }, [refetch]);

  const syncSource = useCallback(
    async (sourceId: string): Promise<{ success: boolean; error?: string }> => {
      setSyncingSourceId(sourceId);
      setError(null);
      setNotice(null);

      try {
        const response = await fetchWithAuth(`/api/schedules/sources/${sourceId}/sync`, {
          method: "POST",
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.message || data?.error || "Failed to sync schedule source.");
        }

        if (isMountedRef.current) {
          setNotice("Schedule source synced.");
        }
        await refetch();
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, {
          context: "useScheduleSourceSummaries.syncSource",
          orgId: orgId ?? undefined,
        });
        if (isMountedRef.current) {
          setError((e as Error).message);
        }
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setSyncingSourceId(null);
        }
      }
    },
    [orgId, refetch]
  );

  const toggleSourceStatus = useCallback(
    async (
      source: ScheduleSourceSummary
    ): Promise<{ success: boolean; error?: string }> => {
      const nextStatus = source.status === "paused" ? "active" : "paused";
      setTogglingSourceId(source.id);
      setError(null);
      setNotice(null);

      try {
        const response = await fetchWithAuth(`/api/schedules/sources/${source.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.message || data?.error || "Failed to update schedule source.");
        }

        if (isMountedRef.current) {
          setNotice(nextStatus === "active" ? "Schedule source resumed." : "Schedule source paused.");
        }
        await refetch();
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, {
          context: "useScheduleSourceSummaries.toggleSourceStatus",
          orgId: orgId ?? undefined,
        });
        if (isMountedRef.current) {
          setError((e as Error).message);
        }
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setTogglingSourceId(null);
        }
      }
    },
    [orgId, refetch]
  );

  const removeSource = useCallback(
    async (sourceId: string): Promise<{ success: boolean; error?: string }> => {
      setRemovingSourceId(sourceId);
      setError(null);
      setNotice(null);

      try {
        const response = await fetchWithAuth(`/api/schedules/sources/${sourceId}`, {
          method: "DELETE",
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.message || data?.error || "Failed to remove schedule source.");
        }

        if (isMountedRef.current) {
          setNotice("Schedule source removed.");
        }
        await refetch();
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, {
          context: "useScheduleSourceSummaries.removeSource",
          orgId: orgId ?? undefined,
        });
        if (isMountedRef.current) {
          setError((e as Error).message);
        }
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setRemovingSourceId(null);
        }
      }
    },
    [orgId, refetch]
  );

  return {
    sources,
    loading,
    syncingSourceId,
    togglingSourceId,
    removingSourceId,
    error,
    notice,
    refetch,
    syncSource,
    toggleSourceStatus,
    removeSource,
  };
}
