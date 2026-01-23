import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Record } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds

interface UseRecordsReturn {
  records: Record[];
  categories: string[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

export function useRecords(orgSlug: string): UseRecordsReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when org changes
  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchRecords = useCallback(async (overrideOrgId?: string) => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setRecords([]);
        setCategories([]);
        setError(null);
        setLoading(false);
        orgIdRef.current = null;
        setOrgId(null);
      }
      return;
    }

    try {
      setLoading(true);

      let resolvedOrgId = overrideOrgId ?? orgIdRef.current;

      if (!resolvedOrgId) {
        // First get org ID from slug
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (orgError) throw orgError;
        resolvedOrgId = org.id;
        orgIdRef.current = resolvedOrgId;
        if (isMountedRef.current) {
          setOrgId(resolvedOrgId);
        }
      }

      // Fetch records ordered by category, then title
      const { data, error: recordsError } = await supabase
        .from("records")
        .select("*")
        .eq("organization_id", resolvedOrgId)
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

      if (isMountedRef.current) {
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
      if (isMountedRef.current) {
        const error = e as { code?: string; message: string };
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          setRecords([]);
          setCategories([]);
          setError(null);
        } else {
          setError(error.message);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgSlug]);

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
    const channel = supabase
      .channel(`records:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "records",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchRecords(orgId);
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
