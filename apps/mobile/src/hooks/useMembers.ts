import { useEffect, useState, useRef } from "react";
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
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = async () => {
    try {
      setLoading(true);

      if (!orgSlug) {
        throw new Error("Organization not specified");
      }

      // First get org ID from slug
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (orgError) throw orgError;

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
        .eq("organization_id", org.id)
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
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchMembers();

    return () => {
      isMountedRef.current = false;
    };
  }, [orgSlug]);

  return { members, loading, error, refetch: fetchMembers };
}
