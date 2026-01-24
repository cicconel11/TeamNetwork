import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface Membership {
  id: string;
  user_id: string;
  role: string;
  status: "active" | "revoked" | "pending";
  created_at: string | null;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

interface UseMembershipsReturn {
  memberships: Membership[];
  pendingMembers: Membership[];
  pendingAlumni: Membership[];
  loading: boolean;
  error: string | null;
  updateRole: (
    userId: string,
    newRole: "admin" | "active_member" | "alumni"
  ) => Promise<{ success: boolean; error?: string }>;
  updateAccess: (
    userId: string,
    status: "active" | "revoked"
  ) => Promise<{ success: boolean; error?: string }>;
  approveMember: (userId: string) => Promise<{ success: boolean; error?: string }>;
  rejectMember: (userId: string) => Promise<{ success: boolean; error?: string }>;
  refetch: () => Promise<void>;
}

export function useMemberships(orgId: string | null): UseMembershipsReturn {
  const isMountedRef = useRef(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemberships = useCallback(async () => {
    if (!orgId) {
      setMemberships([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select(
          `
          id,
          user_id,
          role,
          status,
          created_at,
          user:users(id, email, name, avatar_url)
        `
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        const normalizedMemberships: Membership[] =
          data?.map((m) => {
            const user = Array.isArray(m.user) ? m.user[0] : m.user;
            return {
              id: m.id,
              user_id: m.user_id,
              role: m.role,
              status: m.status as "active" | "revoked" | "pending",
              created_at: m.created_at,
              user: user
                ? {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    avatar_url: user.avatar_url,
                  }
                : null,
            };
          }) || [];

        setMemberships(normalizedMemberships);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
        setMemberships([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchMemberships();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchMemberships]);

  // Realtime subscription
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`memberships:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchMemberships();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchMemberships]);

  const updateRole = useCallback(
    async (
      userId: string,
      newRole: "admin" | "active_member" | "alumni"
    ): Promise<{ success: boolean; error?: string }> => {
      if (!orgId) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const { error: updateError } = await supabase
          .from("user_organization_roles")
          .update({ role: newRole })
          .eq("organization_id", orgId)
          .eq("user_id", userId);

        if (updateError) throw updateError;

        // Optimistic update
        if (isMountedRef.current) {
          setMemberships((prev) =>
            prev.map((m) =>
              m.user_id === userId ? { ...m, role: newRole } : m
            )
          );
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const updateAccess = useCallback(
    async (
      userId: string,
      status: "active" | "revoked"
    ): Promise<{ success: boolean; error?: string }> => {
      if (!orgId) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const { error: updateError } = await supabase
          .from("user_organization_roles")
          .update({ status })
          .eq("organization_id", orgId)
          .eq("user_id", userId);

        if (updateError) throw updateError;

        // Optimistic update
        if (isMountedRef.current) {
          setMemberships((prev) =>
            prev.map((m) =>
              m.user_id === userId ? { ...m, status } : m
            )
          );
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const approveMember = useCallback(
    async (userId: string): Promise<{ success: boolean; error?: string }> => {
      return updateAccess(userId, "active");
    },
    [updateAccess]
  );

  const rejectMember = useCallback(
    async (userId: string): Promise<{ success: boolean; error?: string }> => {
      if (!orgId) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const { error: deleteError } = await supabase
          .from("user_organization_roles")
          .delete()
          .eq("organization_id", orgId)
          .eq("user_id", userId);

        if (deleteError) throw deleteError;

        // Optimistic update
        if (isMountedRef.current) {
          setMemberships((prev) => prev.filter((m) => m.user_id !== userId));
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  // Derived data
  const pendingMembers = memberships.filter(
    (m) =>
      m.status === "pending" &&
      (m.role === "active_member" || m.role === "admin" || m.role === "member")
  );

  const pendingAlumni = memberships.filter(
    (m) => m.status === "pending" && m.role === "alumni"
  );

  return {
    memberships,
    pendingMembers,
    pendingAlumni,
    loading,
    error,
    updateRole,
    updateAccess,
    approveMember,
    rejectMember,
    refetch: fetchMemberships,
  };
}

// Helper functions
export function getRoleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "alumni":
      return "Alumni";
    case "active_member":
      return "Active Member";
    case "member":
      return "Member";
    default:
      return role;
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "revoked":
      return "Revoked";
    case "pending":
      return "Pending";
    default:
      return status;
  }
}
