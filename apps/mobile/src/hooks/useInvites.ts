import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface Invite {
  id: string;
  code: string;
  token: string | null;
  role: string | null;
  uses_remaining: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
}

interface CreateInviteParams {
  role: "active_member" | "admin" | "alumni";
  usesRemaining?: number | null;
  expiresAt?: string | null;
}

interface UseInvitesReturn {
  invites: Invite[];
  loading: boolean;
  error: string | null;
  createInvite: (params: CreateInviteParams) => Promise<{
    success: boolean;
    invite?: Invite;
    error?: string;
  }>;
  revokeInvite: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
  deleteInvite: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
  refetch: () => Promise<void>;
}

export function useInvites(orgId: string | null): UseInvitesReturn {
  const isMountedRef = useRef(true);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    if (!orgId) {
      setInvites([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("organization_invites")
        .select("id, code, token, role, uses_remaining, expires_at, revoked_at, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        setInvites(data || []);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
        setInvites([]);
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
    fetchInvites();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchInvites]);

  // Realtime subscription
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`invites:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_invites",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchInvites();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchInvites]);

  const createInvite = useCallback(
    async (params: CreateInviteParams): Promise<{
      success: boolean;
      invite?: Invite;
      error?: string;
    }> => {
      if (!orgId) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        // Use the server-side RPC for secure code generation
        const { data, error: rpcError } = await supabase.rpc("create_org_invite", {
          p_organization_id: orgId,
          p_role: params.role,
          p_uses: params.usesRemaining ?? undefined,
          p_expires_at: params.expiresAt ?? undefined,
        });

        if (rpcError) throw rpcError;

        if (data && isMountedRef.current) {
          const newInvite = data as Invite;
          setInvites((prev) => [newInvite, ...prev]);
          return { success: true, invite: newInvite };
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const revokeInvite = useCallback(
    async (inviteId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { error: updateError } = await supabase
          .from("organization_invites")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", inviteId);

        if (updateError) throw updateError;

        // Optimistic update
        if (isMountedRef.current) {
          setInvites((prev) =>
            prev.map((inv) =>
              inv.id === inviteId
                ? { ...inv, revoked_at: new Date().toISOString() }
                : inv
            )
          );
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    []
  );

  const deleteInvite = useCallback(
    async (inviteId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { error: deleteError } = await supabase
          .from("organization_invites")
          .delete()
          .eq("id", inviteId);

        if (deleteError) throw deleteError;

        // Optimistic update
        if (isMountedRef.current) {
          setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    []
  );

  return {
    invites,
    loading,
    error,
    createInvite,
    revokeInvite,
    deleteInvite,
    refetch: fetchInvites,
  };
}

// Helper functions
export function getInviteLink(invite: Invite, baseUrl: string): string {
  if (invite.token) {
    return `${baseUrl}/app/join?token=${invite.token}`;
  }
  return `${baseUrl}/app/join?code=${invite.code}`;
}

export function isInviteExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export function isInviteRevoked(revokedAt: string | null): boolean {
  return !!revokedAt;
}

export function isInviteExhausted(usesRemaining: number | null): boolean {
  return usesRemaining !== null && usesRemaining <= 0;
}

export function isInviteValid(invite: Invite): boolean {
  return (
    !isInviteExpired(invite.expires_at) &&
    !isInviteRevoked(invite.revoked_at) &&
    !isInviteExhausted(invite.uses_remaining)
  );
}
