import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import type { ParentInviteRecord } from "@/lib/parents";

const FAR_FUTURE_ISO = "9999-12-31T00:00:00.000Z";

interface OrganizationInviteRow {
  id: string;
  code: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
  role: string | null;
}

function toParentInviteRecord(row: OrganizationInviteRow): ParentInviteRecord {
  return {
    id: row.id,
    code: row.code,
    expires_at: row.expires_at ?? FAR_FUTURE_ISO,
    status: row.revoked_at ? "revoked" : "pending",
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

interface UseParentInvitesReturn {
  invites: ParentInviteRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createInvite: (expiresAt?: string | null) => Promise<{ success: boolean; invite?: ParentInviteRecord; error?: string }>;
  revokeInvite: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
  deleteInvite: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useParentInvites(orgId: string | null, enabled: boolean): UseParentInvitesReturn {
  const isMountedRef = useRef(true);
  const [invites, setInvites] = useState<ParentInviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    if (!orgId || !enabled) {
      if (isMountedRef.current) {
        setInvites([]);
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from("organization_invites")
        .select("id, code, expires_at, revoked_at, created_at, role")
        .eq("organization_id", orgId)
        .eq("role", "parent")
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        const rows = (data as OrganizationInviteRow[] | null) ?? [];
        setInvites(rows.map(toParentInviteRecord));
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useParentInvites.fetchInvites", orgId });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setInvites([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchInvites();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchInvites]);

  useEffect(() => {
    if (!orgId || !enabled) return;

    const channel = createPostgresChangesChannel(`parent-invites:${orgId}`)
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
  }, [orgId, enabled, fetchInvites]);

  const createInvite = useCallback(
    async (expiresAt?: string | null) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const { data, error: rpcError } = await supabase.rpc("create_org_invite", {
          p_organization_id: orgId,
          p_role: "parent",
          p_uses: undefined,
          p_expires_at: expiresAt ?? undefined,
        });

        if (rpcError) throw rpcError;
        if (!data) throw new Error("Failed to create invite");

        const invite = toParentInviteRecord(data as OrganizationInviteRow);
        if (isMountedRef.current) {
          setInvites((prev) => {
            const next = [invite, ...prev.filter((existing) => existing.id !== invite.id)];
            return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          });
        }
        return { success: true, invite };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParentInvites.createInvite", orgId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const { error: updateError } = await supabase
          .from("organization_invites")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", inviteId)
          .eq("organization_id", orgId);

        if (updateError) throw updateError;

        if (isMountedRef.current) {
          setInvites((prev) =>
            prev.map((invite) =>
              invite.id === inviteId ? { ...invite, status: "revoked" } : invite
            )
          );
        }
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParentInvites.revokeInvite", orgId, inviteId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const deleteInvite = useCallback(
    async (inviteId: string) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const { error: deleteError } = await supabase
          .from("organization_invites")
          .delete()
          .eq("id", inviteId)
          .eq("organization_id", orgId);

        if (deleteError) throw deleteError;

        if (isMountedRef.current) {
          setInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
        }
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParentInvites.deleteInvite", orgId, inviteId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  return {
    invites,
    loading,
    error,
    refetch: fetchInvites,
    createInvite,
    revokeInvite,
    deleteInvite,
  };
}
