import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type { Record } from "@teammeet/types";
import { useRequestTracker } from "@/hooks/useRequestTracker";

const STALE_TIME_MS = 30_000; // 30 seconds

interface UseRecordsReturn {
  records: Record[];
  categories: string[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

export function useRecords(orgId: string | null): UseRecordsReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [records, setRecords] = useState<Record[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();

  useEffect(() => {
    invalidateRequests();
    setRecords([]);
    setCategories([]);
    setError(null);
    lastFetchTimeRef.current = 0;
  }, [orgId, invalidateRequests]);

  const fetchRecords = useCallback(async () => {
    const requestId = beginRequest();

    if (!orgId) {
      if (isMountedRef.current) {
        setRecords([]);
        setCategories([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // Fetch records ordered by category, then title
      const { data, error: recordsError } = await supabase
        .from("records")
        .select("*")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("category")
        .order("title");

      if (recordsError) {
        // If table doesn't exist, return empty array
        if (recordsError.code === "42P01") {
          if (isMountedRef.current) {
            setRecords([]);
            setCategories([]);
            setError(null);
          }
          return;
        }
        throw recordsError;
      }

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        const recordsData = (data as Record[]) || [];
        setRecords(recordsData);
        
        // Extract unique categories
        const uniqueCategories = [
          ...new Set(
            recordsData
              .map((r) => r.category)
              .filter((c): c is string => c !== null && c !== "")
          ),
        ];
        setCategories(uniqueCategories);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        const error = e as { code?: string; message: string };
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          setRecords([]);
          setCategories([]);
          setError(null);
        } else {
          const message = error.message || "An error occurred";
          setError(message);
          showToast(message, "error");
          sentry.captureException(e as Error, {
            context: "useRecords",
            orgId,
          });
        }
      }
    } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [beginRequest, isCurrentRequest, orgId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchRecords();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchRecords]);

  // Real-time subscription for records table
  useEffect(() => {
    if (!orgId) return;
    const channel = createPostgresChangesChannel(`records:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "records",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchRecords();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchRecords]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchRecords();
    }
  }, [fetchRecords]);

  return { records, categories, loading, error, refetch: fetchRecords, refetchIfStale };
}
