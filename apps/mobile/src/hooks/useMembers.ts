import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STALE_TIME_MS = 30_000; // 30 seconds

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

interface UseMembersReturn {
  members: Member[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

/**
 * Hook to fetch members for an organization.
 * @param orgId - The organization ID (from useOrg context)
 */
export function useMembers(orgId: string | null): UseMembersReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [members, setMembers] = useState<Member[]>([]);
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

      // Get members joined to users table
      // users table has: id, email, name, avatar_url
      const { data, error: membersError } = await supabase
        .from("user_organization_roles")
        .select(
          `
          id,
          user_id,
          role,
          status,
          user:users(id, email, name, avatar_url)
        `
        )
        .eq("organization_id", orgId)
        .eq("status", "active")
        .in("role", ["admin", "active_member", "member"])
        .order("role", { ascending: true });

      if (membersError) throw membersError;

      if (isMountedRef.current) {
        setMembers((data as unknown as Member[]) || []);
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
      .channel(`members:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
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
