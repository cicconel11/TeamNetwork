"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card, Badge, Select, Input } from "@/components/ui";
import { QRCodeDisplay } from "@/components/invites";

interface PendingMember {
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  users?: { name: string | null; email: string | null };
}

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

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export default function ApprovalsPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [pendingAlumni, setPendingAlumni] = useState<PendingMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // New invite form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [newRole, setNewRole] = useState<"active_member" | "admin" | "alumni">("active_member");
  const [newUses, setNewUses] = useState<string>("");
  const [newExpires, setNewExpires] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);
  const [showQR, setShowQR] = useState<string | null>(null);

  // Fetch pending members and invites
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      // Get org
      const { data: orgs, error: orgError } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .limit(1);

      const org = orgs?.[0];

      if (org && !orgError) {
        setOrgId(org.id);

        // Get pending memberships
        const { data: memberships } = await supabase
          .from("user_organization_roles")
          .select("user_id, role, status, created_at, users(name, email)")
          .eq("organization_id", org.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false });

        const normalizedMemberships: PendingMember[] =
          memberships?.map((m) => {
            const user = Array.isArray(m.users) ? m.users[0] : m.users;
            return {
              user_id: m.user_id,
              role: m.role,
              status: m.status,
              created_at: m.created_at,
              users: {
                name: user?.name ?? null,
                email: user?.email ?? null,
              },
            };
          }) || [];

        // Separate members and alumni
        setPendingMembers(normalizedMemberships.filter(m => m.role === "active_member" || m.role === "admin"));
        setPendingAlumni(normalizedMemberships.filter(m => m.role === "alumni"));

        // Get active invites
        const { data: inviteData } = await supabase
          .from("organization_invites")
          .select("*")
          .eq("organization_id", org.id)
          .is("revoked_at", null)
          .order("created_at", { ascending: false });

        setInvites(inviteData || []);
      }

      setIsLoading(false);
    };

    fetchData();
  }, [orgSlug]);

  const handleApprove = async (userId: string) => {
    if (!orgId) return;
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("user_organization_roles")
      .update({ status: "active" })
      .eq("organization_id", orgId)
      .eq("user_id", userId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Remove from pending lists
    setPendingMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setPendingAlumni((prev) => prev.filter((m) => m.user_id !== userId));
  };

  const handleReject = async (userId: string) => {
    if (!orgId) return;
    if (!confirm("Are you sure you want to reject this request? This will remove the user.")) return;

    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("user_organization_roles")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", userId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    // Remove from pending lists
    setPendingMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setPendingAlumni((prev) => prev.filter((m) => m.user_id !== userId));
  };

  const handleCreateInvite = async () => {
    if (!orgId) return;
    setIsCreating(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const code = generateCode();
    const token = generateToken();
    const usesRemaining = newUses ? parseInt(newUses) : null;
    const expiresAt = newExpires ? new Date(newExpires).toISOString() : null;

    const { data, error: insertError } = await supabase
      .from("organization_invites")
      .insert({
        organization_id: orgId,
        code,
        token,
        role: newRole,
        uses_remaining: usesRemaining,
        expires_at: expiresAt,
        created_by_user_id: user?.id,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
    } else if (data) {
      setInvites([data, ...invites]);
      setShowInviteForm(false);
      setNewRole("active_member");
      setNewUses("");
      setNewExpires("");
    }

    setIsCreating(false);
  };

  const handleRevokeInvite = async (inviteId: string) => {
    const supabase = createClient();
    await supabase
      .from("organization_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId);

    setInvites(invites.filter((i) => i.id !== inviteId));
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const getInviteLink = (invite: Invite) => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    if (invite.token) {
      return `${base}/app/join?token=${invite.token}`;
    }
    return `${base}/app/join?code=${invite.code}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "admin": return "Admin";
      case "alumni": return "Alumni";
      case "active_member": return "Active Member";
      case "member": return "Member";
      default: return role;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "warning";
      case "alumni": return "muted";
      default: return "primary";
    }
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Member Approvals" description="Loading..." />
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const totalPending = pendingMembers.length + pendingAlumni.length;

  return (
    <div>
      <PageHeader
        title="Member Approvals"
        description="Review and approve pending membership requests"
        backHref={`/${orgSlug}`}
      />

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Invite Link Section */}
      <Card className="p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">Invite Links</h3>
            <p className="text-sm text-muted-foreground">Generate invite links for new members</p>
          </div>
          {!showInviteForm && (
            <Button onClick={() => setShowInviteForm(true)} size="sm">
              <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Invite
            </Button>
          )}
        </div>

        {showInviteForm && (
          <div className="p-4 rounded-xl bg-muted/50 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Select
                label="Role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "active_member" | "admin" | "alumni")}
                options={[
                  { value: "active_member", label: "Active Member" },
                  { value: "admin", label: "Admin" },
                  { value: "alumni", label: "Alumni" },
                ]}
              />
              <Input
                label="Max Uses"
                type="number"
                value={newUses}
                onChange={(e) => setNewUses(e.target.value)}
                placeholder="Unlimited"
                min={1}
              />
              <Input
                label="Expires On"
                type="date"
                value={newExpires}
                onChange={(e) => setNewExpires(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button onClick={handleCreateInvite} isLoading={isCreating}>
                Generate Link
              </Button>
              <Button variant="secondary" onClick={() => setShowInviteForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {invites.length > 0 ? (
          <div className="space-y-3">
            {invites.slice(0, 3).map((invite) => {
              const inviteLink = getInviteLink(invite);
              const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
              const isExhausted = invite.uses_remaining !== null && invite.uses_remaining <= 0;

              return (
                <div key={invite.id} className={`p-4 rounded-xl border border-border ${isExpired || isExhausted ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <code className="font-mono text-lg font-bold">{invite.code}</code>
                      <Badge variant={getRoleBadgeVariant(invite.role)}>
                        {getRoleLabel(invite.role)}
                      </Badge>
                      {isExpired && <Badge variant="error">Expired</Badge>}
                      {isExhausted && <Badge variant="error">No uses left</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyToClipboard(inviteLink, `link-${invite.id}`)}
                      >
                        {copied === `link-${invite.id}` ? "Copied!" : "Copy Link"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowQR(showQR === invite.id ? null : invite.id)}
                      >
                        QR
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500"
                        onClick={() => handleRevokeInvite(invite.id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                  {showQR === invite.id && (
                    <div className="mt-4 pt-4 border-t border-border flex justify-center">
                      <QRCodeDisplay url={inviteLink} size={180} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No active invites. Create one to let people join.
          </p>
        )}
      </Card>

      {/* Pending Members Section */}
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        Pending Members
        {pendingMembers.length > 0 && (
          <Badge variant="warning">{pendingMembers.length}</Badge>
        )}
      </h2>

      {pendingMembers.length > 0 ? (
        <div className="space-y-3 mb-8">
          {pendingMembers.map((member) => (
            <Card key={member.user_id} className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {member.users?.name || member.users?.email || "Unknown User"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {member.users?.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested {formatDate(member.created_at)} • {getRoleLabel(member.role)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(member.user_id)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => handleReject(member.user_id)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center mb-8">
          <p className="text-sm text-muted-foreground">No pending member requests</p>
        </Card>
      )}

      {/* Pending Alumni Section */}
      <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        Pending Alumni
        {pendingAlumni.length > 0 && (
          <Badge variant="warning">{pendingAlumni.length}</Badge>
        )}
      </h2>

      {pendingAlumni.length > 0 ? (
        <div className="space-y-3">
          {pendingAlumni.map((member) => (
            <Card key={member.user_id} className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-medium text-foreground">
                    {member.users?.name || member.users?.email || "Unknown User"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {member.users?.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested {formatDate(member.created_at)} • Alumni
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(member.user_id)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => handleReject(member.user_id)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">No pending alumni requests</p>
        </Card>
      )}

      {totalPending === 0 && (
        <div className="mt-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-muted-foreground">All caught up! No pending approvals.</p>
        </div>
      )}
    </div>
  );
}
