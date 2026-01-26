import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STALE_TIME_MS = 30_000;

export interface DirectoryMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  graduation_year: number | null;
  role: string | null;
  linkedin_url: string | null;
}

interface UseMemberDirectoryReturn {
  members: DirectoryMember[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/**
 * Hook to fetch member directory for an organization.
 * @param orgId - The organization ID (from useOrg context)
 */
export function useMemberDirectory(orgId: string | null): UseMemberDirectoryReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    lastFetchTimeRef.current = 0;
  }, [orgId]);

  const fetchMembers = useCallback(async () => {
    if (!orgId) {
      if (isMountedRef.current) {
        setMembers([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      const { data, error: membersError } = await supabase
        .from("members")
        .select(
          `
          id,
          first_name,
          last_name,
          email,
          photo_url,
          graduation_year,
          role,
          linkedin_url
        `
        )
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("last_name", { ascending: true });

      if (membersError) throw membersError;

      if (isMountedRef.current) {
        setMembers((data as DirectoryMember[]) || []);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchMembers();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchMembers]);

  // Real-time subscription for member changes
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`member-directory:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "members",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchMembers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchMembers]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchMembers();
    }
  }, [fetchMembers]);

  return { members, loading, error, refetch: fetchMembers, refetchIfStale };
}
