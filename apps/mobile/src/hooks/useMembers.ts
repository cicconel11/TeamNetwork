import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

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
}

export function useMembers(orgSlug: string): UseMembersReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
  }, [orgSlug]);

  const fetchMembers = useCallback(async (overrideOrgId?: string) => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setMembers([]);
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
        if (!org) throw new Error("Organization not found");

        resolvedOrgId = org.id;
        orgIdRef.current = resolvedOrgId;
        if (isMountedRef.current) {
          setOrgId(resolvedOrgId);
        }
      }

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
        .eq("organization_id", resolvedOrgId)
        .eq("status", "active")
        .in("role", ["admin", "active_member", "member"])
        .order("role", { ascending: true });

      if (membersError) throw membersError;

      if (isMountedRef.current) {
        setMembers((data as unknown as Member[]) || []);
        setError(null);
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
  }, [orgSlug]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchMembers();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchMembers]);

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
          fetchMembers(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchMembers]);

  return { members, loading, error, refetch: fetchMembers };
}
