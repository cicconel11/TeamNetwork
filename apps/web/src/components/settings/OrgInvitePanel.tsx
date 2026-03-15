"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { QRCodeDisplay } from "@/components/invites";
import { buildInviteLink } from "@/lib/invites/buildInviteLink";
import { getRoleBadgeVariant, getRoleLabel } from "@/lib/auth/role-display";
import { formatShortDate, isExpired } from "@/lib/utils/dates";

interface Invite {
  id: string;
  code: string;
  token: string | null;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface ParentInvite {
  id: string;
  email: string | null;
  code: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: string | null;
  created_at: string;
}

interface InviteItem {
  kind: "org" | "parent";
  id: string;
  code: string;
  created_at: string;
  expires_at: string | null;
  token?: string | null;
  role?: string;
  uses_remaining?: number | null;
  revoked_at?: string | null;
  status?: "pending" | "accepted" | "revoked";
  email?: string;
}

interface OrgInvitePanelProps {
  orgId: string;
  quotaLimit: number | null;
  alumniCount: number;
  showForm: boolean;
  onShowFormChange: (show: boolean) => void;
  onAlumniInviteCreated: () => void;
}

export function OrgInvitePanel({
  orgId,
  quotaLimit,
  alumniCount,
  showForm,
  onShowFormChange,
  onAlumniInviteCreated,
}: OrgInvitePanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [orgInvites, setOrgInvites] = useState<Invite[]>([]);
  const [parentInvites, setParentInvites] = useState<ParentInvite[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingParentInviteId, setDeletingParentInviteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Form state
  const [newRole, setNewRole] = useState<"active_member" | "admin" | "alumni" | "parent">("active_member");
  const [newUses, setNewUses] = useState("");
  const [newExpires, setNewExpires] = useState("");

  // Fetch invites
  useEffect(() => {
    const fetchInvites = async () => {
      const [inviteResult, parentInviteResult] = await Promise.all([
        supabase
          .from("organization_invites")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("parent_invites")
          .select("id,email,code,expires_at,status,created_at")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
      ]);

      if (inviteResult.error) {
        console.error("Failed to fetch invites:", inviteResult.error.message);
      }
      setOrgInvites(inviteResult.data || []);

      if (parentInviteResult.error) {
        console.error("Failed to fetch parent invites:", parentInviteResult.error.message);
      }
      setParentInvites((parentInviteResult.data as ParentInvite[] | null) || []);
    };

    fetchInvites();
  }, [orgId, supabase]);

  const handleCreateInvite = async () => {
    if (newRole === "parent") {
      setIsCreating(true);
      setError(null);

      try {
        const res = await fetch(`/api/organizations/${orgId}/parents/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expires_at: newExpires ? new Date(newExpires).toISOString() : null }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Unable to create parent invite");
        }

        const invite = data.invite as ParentInvite | undefined;
        if (invite) {
          const normalizedInvite: ParentInvite = {
            id: invite.id,
            email: invite.email ?? null,
            code: invite.code,
            status: invite.status,
            expires_at: invite.expires_at ?? null,
            created_at: invite.created_at ?? new Date().toISOString(),
          };
          setParentInvites((prev) => [
            normalizedInvite,
            ...prev.filter((item) => item.id !== normalizedInvite.id),
          ]);
        }

        onShowFormChange(false);
        setNewRole("active_member");
        setNewUses("");
        setNewExpires("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to create parent invite");
      } finally {
        setIsCreating(false);
      }

      return;
    }

    setIsCreating(true);
    setError(null);
    const creatingRole = newRole;
    let succeeded = false;

    try {
      const usesRemaining = newUses ? parseInt(newUses, 10) : null;
      const expiresAt = newExpires ? new Date(newExpires).toISOString() : null;

      const res = await fetch(`/api/organizations/${orgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: newRole,
          uses: usesRemaining,
          expiresAt,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Unable to create invite");
      }

      const invite = (data as { invite?: Invite }).invite;
      if (invite) {
        setOrgInvites((prev) => [invite, ...prev]);
      }

      onShowFormChange(false);
      setNewRole("active_member");
      setNewUses("");
      setNewExpires("");
      succeeded = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create invite");
    } finally {
      setIsCreating(false);
      if (succeeded && creatingRole === "alumni") {
        onAlumniInviteCreated();
      }
    }
  };

  const handleDeleteInvite = async (inviteId: string) => {
    await supabase
      .from("organization_invites")
      .delete()
      .eq("id", inviteId);

    setOrgInvites((prev) => prev.filter((i) => i.id !== inviteId));
  };

  const handleRevokeInvite = async (inviteId: string) => {
    await supabase
      .from("organization_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId);

    setOrgInvites((prev) =>
      prev.map((i) =>
        i.id === inviteId ? { ...i, revoked_at: new Date().toISOString() } : i
      )
    );
  };

  const handleDeleteParentInvite = async (inviteId: string) => {
    if (!confirm("Delete this parent invite link? Anyone who already joined will keep access.")) {
      return;
    }

    setDeletingParentInviteId(inviteId);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}/parents/invite/${inviteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete parent invite");
      }

      setParentInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
      setShowQR((prev) => (prev === `parent-${inviteId}` ? null : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete parent invite");
    } finally {
      setDeletingParentInviteId(null);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(null), 2000);
  };

  const getInviteLink = (invite: InviteItem) => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return buildInviteLink({
      kind: invite.kind,
      baseUrl: base,
      orgId,
      code: invite.code,
      token: invite.token ?? undefined,
    });
  };

  const isRevoked = (revokedAt: string | null) => !!revokedAt;

  const allInvites: InviteItem[] = useMemo(() => [
    ...orgInvites.map((invite) => ({
      kind: "org" as const,
      id: invite.id,
      code: invite.code,
      created_at: invite.created_at,
      expires_at: invite.expires_at,
      token: invite.token,
      role: invite.role,
      uses_remaining: invite.uses_remaining,
      revoked_at: invite.revoked_at,
    })),
    ...parentInvites.map((invite) => ({
      kind: "parent" as const,
      id: invite.id,
      code: invite.code,
      created_at: invite.created_at,
      expires_at: invite.expires_at,
      status: invite.status,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [orgInvites, parentInvites]);

  const atAlumniLimit = quotaLimit !== null && alumniCount >= quotaLimit;

  return (
    <>
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Create Invite Form */}
      {showForm && (
        <Card className="p-6 mb-6">
          <h3 className="font-semibold text-foreground mb-4">Create New Invite</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Select
              label="Role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "active_member" | "admin" | "alumni" | "parent")}
              options={[
                { value: "active_member", label: "Active Member" },
                { value: "admin", label: "Admin" },
                { value: "alumni", label: "Alumni" },
                { value: "parent", label: "Parent" },
              ]}
            />
            {newRole !== "parent" && (
              <Input
                label="Max Uses"
                type="number"
                value={newUses}
                onChange={(e) => setNewUses(e.target.value)}
                placeholder="Unlimited"
                min={1}
              />
            )}
            <Input
              label="Expires On"
              type="date"
              value={newExpires}
              onChange={(e) => setNewExpires(e.target.value)}
            />
          </div>
          {newRole === "alumni" && atAlumniLimit && (
            <p className="text-xs text-amber-600">
              Alumni limit reached for your plan. Upgrade above to add more alumni invites.
            </p>
          )}
          <div className="flex gap-3">
            <Button onClick={handleCreateInvite} isLoading={isCreating}>
              Generate Code
            </Button>
            <Button variant="secondary" onClick={() => onShowFormChange(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Invites List */}
      {allInvites.length > 0 ? (
        <div className="space-y-4">
          {allInvites.map((invite) => {
            const inviteKey = `${invite.kind}-${invite.id}`;
            const role = invite.kind === "parent" ? "parent" : invite.role ?? "active_member";
            const isExpiredInvite = isExpired(invite.expires_at);
            const expired = invite.kind === "org" ? isExpiredInvite : invite.status === "pending" && isExpiredInvite;
            const revoked = invite.kind === "org" ? isRevoked(invite.revoked_at ?? null) : invite.status === "revoked";
            const exhausted = invite.kind === "org" && invite.uses_remaining != null && invite.uses_remaining <= 0;
            const accepted = invite.kind === "parent" && invite.status === "accepted";
            const isDeletingParentInvite = invite.kind === "parent" && deletingParentInviteId === invite.id;
            const invalid = expired || exhausted || revoked;
            const inviteLink = getInviteLink(invite);

            return (
              <Card key={inviteKey} className={`p-6 ${invalid ? "opacity-60" : ""}`}>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div>
                        <div
                          className="font-mono text-xl font-bold tracking-wider cursor-pointer hover:text-emerald-500 transition-colors"
                          onClick={() => copyToClipboard(invite.code, `code-${inviteKey}`)}
                          title="Click to copy code"
                        >
                          {invite.code}
                          {copied === `code-${inviteKey}` && (
                            <span className="ml-2 text-xs text-emerald-500 font-normal">Copied!</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant={getRoleBadgeVariant(role)}>
                          {getRoleLabel(role)}
                        </Badge>
                        {expired && <Badge variant="error">Expired</Badge>}
                        {exhausted && <Badge variant="error">No uses left</Badge>}
                        {revoked && <Badge variant="error">Revoked</Badge>}
                        {accepted && <Badge variant="success">Accepted</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyToClipboard(inviteLink, `link-${inviteKey}`)}
                        className="text-emerald-600 hover:text-emerald-700"
                      >
                        <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                        </svg>
                        {copied === `link-${inviteKey}` ? "Copied!" : "Copy Link"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowQR(showQR === inviteKey ? null : inviteKey)}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                        </svg>
                      </Button>
                      <div className="text-sm text-muted-foreground text-right hidden sm:block">
                        {invite.kind === "org" ? (
                          <div>
                            {invite.uses_remaining !== null
                              ? `${invite.uses_remaining} uses left`
                              : "Unlimited uses"}
                          </div>
                        ) : (
                          <div>Parent invite</div>
                        )}
                        {invite.expires_at && (
                          <div>Expires {formatShortDate(invite.expires_at)}</div>
                        )}
                      </div>
                      {invite.kind === "org" && !revoked && !expired && !exhausted && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeInvite(invite.id)}
                          className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        >
                          Revoke
                        </Button>
                      )}
                      {invite.kind === "parent" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteParentInvite(invite.id)}
                          isLoading={isDeletingParentInvite}
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </Button>
                      )}
                      {invite.kind === "org" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteInvite(invite.id)}
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* QR Code Section */}
                  {showQR === inviteKey && (
                    <div className="border-t border-border pt-4 flex justify-center">
                      <QRCodeDisplay url={inviteLink} size={180} />
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h3 className="font-semibold text-foreground mb-2">No invite codes yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create an invite code to let people join your organization.
          </p>
          <Button onClick={() => onShowFormChange(true)}>Create Invite Code</Button>
        </Card>
      )}
    </>
  );
}
