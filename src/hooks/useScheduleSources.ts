"use client";

import { useCallback, useEffect, useState } from "react";

export type SourceStatus = "active" | "paused" | "error";

export type SourceSummary = {
  id: string;
  vendor_id: "ics" | "vendorA" | "vendorB" | "generic_html";
  maskedUrl: string;
  status: SourceStatus;
  last_synced_at: string | null;
  last_error: string | null;
  title: string | null;
};

type UseScheduleSourcesOptions = {
  orgId: string;
  isAdmin: boolean;
};

export function useScheduleSources({ orgId, isAdmin }: UseScheduleSourcesOptions) {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [updatingSourceId, setUpdatingSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const refreshSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const response = await fetch(`/api/schedules/sources?orgId=${orgId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load sources.");
      }

      setSources(data.sources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources.");
    } finally {
      setLoadingSources(false);
    }
  }, [orgId]);

  useEffect(() => {
    refreshSources();
  }, [refreshSources]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      refreshSources();
    };
    window.addEventListener("schedule:sources:refresh", handler);
    return () => {
      window.removeEventListener("schedule:sources:refresh", handler);
    };
  }, [refreshSources]);

  const handleSync = useCallback(async (sourceId: string) => {
    setSyncingSourceId(sourceId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/schedules/sources/${sourceId}/sync`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to sync schedule.");
      }

      setNotice("Schedule synced.");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync schedule.");
    } finally {
      setSyncingSourceId(null);
    }
  }, [refreshSources]);

  const handleToggleStatus = useCallback(async (source: SourceSummary) => {
    if (!isAdmin) {
      setError("Only admins can update schedule sources.");
      return;
    }

    setUpdatingSourceId(source.id);
    setError(null);
    setNotice(null);

    try {
      const nextStatus = source.status === "paused" ? "active" : "paused";
      const response = await fetch(`/api/schedules/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to update schedule source.");
      }

      setNotice(nextStatus === "active" ? "Schedule resumed." : "Schedule paused.");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update schedule source.");
    } finally {
      setUpdatingSourceId(null);
    }
  }, [isAdmin, refreshSources]);

  const handleRemove = useCallback(async (sourceId: string) => {
    if (!isAdmin) {
      setError("Only admins can remove schedule sources.");
      return;
    }

    if (!confirm("Remove this schedule source?")) {
      return;
    }

    setUpdatingSourceId(sourceId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/schedules/sources/${sourceId}`, { method: "DELETE" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to remove schedule source.");
      }

      setNotice("Schedule source removed.");
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove schedule source.");
    } finally {
      setUpdatingSourceId(null);
    }
  }, [isAdmin, refreshSources]);

  return {
    sources,
    loadingSources,
    syncingSourceId,
    updatingSourceId,
    error,
    notice,
    clearMessages,
    refreshSources,
    handleSync,
    handleToggleStatus,
    handleRemove,
  };
}
