"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
  require_approval: boolean | null;
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
  source: "organization_invite" | "legacy_parent_invite";
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
  require_approval?: boolean | null;
}

interface OrgInvitePanelProps {
  orgId: string;
  quotaLimit: number | null;
  alumniCount: number;
  showForm: boolean;
  onShowFormChange: (show: boolean) => void;
  onAlumniInviteCreated: () => void;
  orgRequireApproval: boolean;
}

export function OrgInvitePanel({
  orgId,
  quotaLimit,
  alumniCount,
  showForm,
  onShowFormChange,
  onAlumniInviteCreated,
  orgRequireApproval,
}: OrgInvitePanelProps) {
  const tInvites = useTranslations("invites");
  const tCommon = useTranslations("common");
  const tRoles = useTranslations("roles");
  const supabase = useMemo(() => createClient(), []);
  const [orgInvites, setOrgInvites] = useState<Invite[]>([]);
  const [parentInvites, setParentInvites] = useState<ParentInvite[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingParentInviteId, setDeletingParentInviteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 25;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Form state
  const [newRole, setNewRole] = useState<"active_member" | "admin" | "alumni" | "parent">("active_member");
  const [newUses, setNewUses] = useState("");
  const [newExpires, setNewExpires] = useState("");
  const [newRequireApproval, setNewRequireApproval] = useState<boolean | null>(null);

  // Fetch invites
  useEffect(() => {
    const fetchInvites = async () => {
      const [inviteResult, parentInviteResult] = await Promise.all([
        supabase
          .from("organization_invites")
          .select("id, code, token, role, uses_remaining, expires_at, revoked_at, created_at, require_approval")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(200),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("parent_invites")
          .select("id,email,code,expires_at,status,created_at")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .limit(200),
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
    setIsCreating(true);
    setError(null);
    const creatingRole = newRole;
    let succeeded = false;

    try {
      const usesRemaining = newUses ? parseInt(newUses, 10) : null;
      const expiresAt = newExpires ? new Date(`${newExpires}T23:59:59`).toISOString() : null;

      const res = await fetch(`/api/organizations/${orgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: newRole,
          uses: usesRemaining,
          expiresAt,
          requireApproval: newRequireApproval,
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
      setNewRequireApproval(null);
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

  const handleDeleteParentInvite = async (invite: InviteItem) => {
    if (!confirm(tInvites("deleteParentConfirm"))) {
      return;
    }

    setDeletingParentInviteId(invite.id);
    setError(null);

    try {
      if (invite.source === "organization_invite") {
        const { error: deleteError } = await supabase
          .from("organization_invites")
          .delete()
          .eq("id", invite.id);

        if (deleteError) {
          throw new Error(deleteError.message || tInvites("failedDeleteParent"));
        }

        setOrgInvites((prev) => prev.filter((item) => item.id !== invite.id));
      } else {
        const res = await fetch(`/api/organizations/${orgId}/parents/invite/${invite.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || tInvites("failedDeleteParent"));
        }

        setParentInvites((prev) => prev.filter((item) => item.id !== invite.id));
      }

      setShowQR((prev) => (prev === `${invite.kind}-${invite.id}` ? null : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : tInvites("failedDeleteParent"));
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
      source: "organization_invite" as const,
      kind: invite.role === "parent" ? "parent" as const : "org" as const,
      id: invite.id,
      code: invite.code,
      created_at: invite.created_at,
      expires_at: invite.expires_at,
      token: invite.token,
      role: invite.role,
      uses_remaining: invite.uses_remaining,
      revoked_at: invite.revoked_at,
      require_approval: invite.require_approval,
    })),
    ...parentInvites.map((invite) => ({
      source: "legacy_parent_invite" as const,
      kind: "parent" as const,
      id: invite.id,
      code: invite.code,
      created_at: invite.created_at,
      expires_at: invite.expires_at,
      status: invite.status,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [orgInvites, parentInvites]);

  // Reset visible count when the invite list changes (e.g., after create/delete)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [orgInvites.length, parentInvites.length]);

  const visibleInvites = allInvites.slice(0, visibleCount);
  const hasMoreVisible = allInvites.length > visibleCount;
  const hitServerCap = orgInvites.length >= 200 || parentInvites.length >= 200;

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
          <h3 className="font-semibold text-foreground mb-4">{tInvites("createNew")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Select
              label={tCommon("role")}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "active_member" | "admin" | "alumni" | "parent")}
              options={[
                { value: "active_member", label: tRoles("activeMember") },
                { value: "admin", label: tRoles("admin") },
                { value: "alumni", label: tRoles("alumni") },
                { value: "parent", label: tRoles("parent") },
              ]}
            />
            <Input
              label={tInvites("maxUses")}
              type="number"
              value={newUses}
              onChange={(e) => setNewUses(e.target.value)}
              placeholder={tCommon("unlimited")}
              min={1}
            />
            <Input
              label={tInvites("expiresOn")}
              type="date"
              value={newExpires}
              onChange={(e) => setNewExpires(e.target.value)}
            />
          </div>
          {orgRequireApproval ? (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm">
              {tInvites("approvalNote")}
            </div>
          ) : (
            <div className="mb-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newRequireApproval === true}
                  onChange={(e) => setNewRequireApproval(e.target.checked ? true : null)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-foreground">
                  {tInvites("requireApprovalLabel")}
                </span>
              </label>
            </div>
          )}
          {newRole === "alumni" && atAlumniLimit && (
            <p className="text-xs text-amber-600">
              {tInvites("alumniLimitReached")}
            </p>
          )}
          <div className="flex gap-3">
            <Button data-testid="invite-submit" onClick={handleCreateInvite} isLoading={isCreating}>
              {tInvites("generateCode")}
            </Button>
            <Button variant="secondary" onClick={() => onShowFormChange(false)}>
              {tCommon("cancel")}
            </Button>
          </div>
        </Card>
      )}

      {/* Invites List */}
      {allInvites.length > 0 ? (
        <div className="space-y-4">
          {visibleInvites.map((invite) => {
            const inviteKey = `${invite.kind}-${invite.id}`;
            const isLegacyParentInvite = invite.source === "legacy_parent_invite";
            const role = invite.kind === "parent" ? "parent" : invite.role ?? "active_member";
            const isExpiredInvite = isExpired(invite.expires_at);
            const expired = isLegacyParentInvite ? invite.status === "pending" && isExpiredInvite : isExpiredInvite;
            const revoked = isLegacyParentInvite ? invite.status === "revoked" : isRevoked(invite.revoked_at ?? null);
            const exhausted =
              invite.source === "organization_invite" &&
              invite.uses_remaining != null &&
              invite.uses_remaining <= 0;
            const accepted = isLegacyParentInvite && invite.status === "accepted";
            const isDeletingParentInvite = invite.kind === "parent" && deletingParentInviteId === invite.id;
            const invalid = expired || exhausted || revoked;
            const inviteLink = getInviteLink(invite);

            return (
              <Card key={inviteKey} data-testid="invite-row" className={`p-6 ${invalid ? "opacity-60" : ""}`}>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div>
                        <div
                          className="font-mono text-xl font-bold tracking-wider cursor-pointer hover:text-emerald-500 transition-colors"
                          onClick={() => copyToClipboard(invite.code, `code-${inviteKey}`)}
                          title={tInvites("clickToCopy")}
                        >
                          {invite.code}
                          {copied === `code-${inviteKey}` && (
                            <span className="ml-2 text-xs text-emerald-500 font-normal">{tCommon("copied")}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant={getRoleBadgeVariant(role)}>
                          {getRoleLabel(role)}
                        </Badge>
                        {invite.require_approval === true && (
                          <Badge variant="warning">{tInvites("approvalRequired")}</Badge>
                        )}
                        {invite.require_approval === false && (
                          <Badge variant="success">{tInvites("autoApprove")}</Badge>
                        )}
                        {expired && <Badge variant="error">{tCommon("expired")}</Badge>}
                        {exhausted && <Badge variant="error">{tInvites("noUsesLeft")}</Badge>}
                        {revoked && <Badge variant="error">{tInvites("revoked")}</Badge>}
                        {accepted && <Badge variant="success">{tInvites("accepted")}</Badge>}
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
                        {copied === `link-${inviteKey}` ? tCommon("copied") : tInvites("copyLink")}
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
                        {invite.source === "organization_invite" ? (
                          <div>
                            {invite.uses_remaining !== null
                              ? tCommon("usesLeft", { count: invite.uses_remaining ?? 0 })
                              : tCommon("unlimitedUses")}
                          </div>
                        ) : (
                          <div>{tInvites("legacyParent")}</div>
                        )}
                        {invite.expires_at && (
                          <div>{tInvites("expires")} {formatShortDate(invite.expires_at)}</div>
                        )}
                      </div>
                      {invite.source === "organization_invite" && !revoked && !expired && !exhausted && (
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="invite-revoke"
                          onClick={() => handleRevokeInvite(invite.id)}
                          className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        >
                          {tCommon("revoke")}
                        </Button>
                      )}
                      {invite.kind === "parent" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteParentInvite(invite)}
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
          {hitServerCap && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm text-center">
              Showing the 200 most recent invites. Older invites are not displayed.
            </div>
          )}
          {hasMoreVisible && (
            <div className="text-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              >
                Show more ({allInvites.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h3 className="font-semibold text-foreground mb-2">{tInvites("noInvitesYet")}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {tInvites("noInvitesDesc")}
          </p>
          <Button onClick={() => onShowFormChange(true)}>{tInvites("createInviteCode")}</Button>
        </Card>
      )}
    </>
  );
}
