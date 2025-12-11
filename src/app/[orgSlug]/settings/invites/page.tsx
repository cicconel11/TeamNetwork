"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card, Input, Select, Badge } from "@/components/ui";

interface Invite {
  id: string;
  code: string;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
  created_at: string;
}

interface Membership {
  user_id: string;
  role: string;
  status: "active" | "revoked";
  users?: { name: string | null; email: string | null };
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function InvitesPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [invites, setInvites] = useState<Invite[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  // New invite form state
  const [showForm, setShowForm] = useState(false);
  const [newRole, setNewRole] = useState<"member" | "admin">("member");
  const [newUses, setNewUses] = useState<string>("");
  const [newExpires, setNewExpires] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch org and invites
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

        // Get invites
        const { data: inviteData } = await supabase
          .from("organization_invites")
          .select("*")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false });

        setInvites(inviteData || []);

          const { data: membershipRows } = await supabase
            .from("user_organization_roles")
            .select("user_id, role, status, users(name,email)")
            .eq("organization_id", org.id);

          const normalizedMemberships: Membership[] =
            membershipRows?.map((m) => {
              const user = Array.isArray(m.users) ? m.users[0] : m.users;
              return {
                user_id: m.user_id,
                role: m.role,
                status: m.status,
                users: {
                  name: user?.name ?? null,
                  email: user?.email ?? null,
                },
              };
            }) || [];

          setMemberships(normalizedMemberships);
      }

      setIsLoading(false);
    };

    fetchData();
  }, [orgSlug]);

  const handleCreateInvite = async () => {
    if (!orgId) return;
    setIsCreating(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const code = generateCode();
    const usesRemaining = newUses ? parseInt(newUses) : null;
    const expiresAt = newExpires ? new Date(newExpires).toISOString() : null;

    const { data, error: insertError } = await supabase
      .from("organization_invites")
      .insert({
        organization_id: orgId,
        code,
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
      setShowForm(false);
      setNewRole("member");
      setNewUses("");
      setNewExpires("");
    }

    setIsCreating(false);
  };

  const handleDeleteInvite = async (inviteId: string) => {
    const supabase = createClient();
    await supabase
      .from("organization_invites")
      .delete()
      .eq("id", inviteId);

    setInvites(invites.filter(i => i.id !== inviteId));
  };

  const cancelSubscription = async () => {
    if (!orgId) return;
    if (!confirm("Cancel billing for this organization? Access will end when the period closes.")) return;

    setIsCancelling(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}/cancel-subscription`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to cancel subscription");
      }
      alert("Subscription canceled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel subscription");
    } finally {
      setIsCancelling(false);
    }
  };

  const deleteOrganization = async () => {
    if (!orgId) return;
    if (!confirm("This will delete the organization, all data, and cancel billing. Continue?")) return;

    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to delete organization");
      }
      alert("Organization deleted.");
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete organization");
      setIsDeleting(false);
    }
  };

  const copyToClipboard = (code: string, type: "code" | "link" = "code") => {
    const textToCopy = type === "link" 
      ? `${window.location.origin}/app/join?code=${code}`
      : code;
    navigator.clipboard.writeText(textToCopy);
    setCopied(`${type}-${code}`);
    setTimeout(() => setCopied(null), 2000);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const updateAccess = async (userId: string, status: "active" | "revoked") => {
    if (!orgId) return;
    const supabase = createClient();
    await supabase
      .from("user_organization_roles")
      .update({ status })
      .eq("organization_id", orgId)
      .eq("user_id", userId);

    setMemberships((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, status } : m))
    );
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Invite Members" description="Loading..." />
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Invite Members"
        description="Create and manage invite codes for your organization"
        backHref={`/${orgSlug}`}
        actions={
          !showForm && (
            <Button onClick={() => setShowForm(true)}>
              <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Invite
            </Button>
          )
        }
      />

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
              onChange={(e) => setNewRole(e.target.value as "member" | "admin")}
              options={[
                { value: "member", label: "Member" },
                { value: "admin", label: "Admin" },
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
              Generate Code
            </Button>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Invites List */}
      {invites.length > 0 ? (
        <div className="space-y-4">
          {invites.map((invite) => {
            const expired = isExpired(invite.expires_at);
            const exhausted = invite.uses_remaining !== null && invite.uses_remaining <= 0;
            const invalid = expired || exhausted;

            return (
              <Card key={invite.id} className={`p-6 ${invalid ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div
                      className="font-mono text-xl font-bold tracking-wider cursor-pointer hover:text-emerald-500 transition-colors"
                      onClick={() => copyToClipboard(invite.code, "code")}
                      title="Click to copy code"
                    >
                      {invite.code}
                      {copied === `code-${invite.code}` && (
                        <span className="ml-2 text-xs text-emerald-500 font-normal">Copied!</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Badge variant={invite.role === "admin" ? "warning" : "primary"}>
                        {invite.role}
                      </Badge>
                      {expired && <Badge variant="error">Expired</Badge>}
                      {exhausted && <Badge variant="error">No uses left</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(invite.code, "link")}
                      className="text-emerald-600 hover:text-emerald-700"
                    >
                      <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                      </svg>
                      {copied === `link-${invite.code}` ? "Copied!" : "Copy Link"}
                    </Button>
                    <div className="text-sm text-muted-foreground text-right hidden sm:block">
                      <div>
                        {invite.uses_remaining !== null
                          ? `${invite.uses_remaining} uses left`
                          : "Unlimited uses"}
                      </div>
                      {invite.expires_at && (
                        <div>Expires {formatDate(invite.expires_at)}</div>
                      )}
                    </div>
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
                  </div>
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
          <Button onClick={() => setShowForm(true)}>Create Invite Code</Button>
        </Card>
      )}

      {/* Access control */}
      <Card className="p-6 mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">Access control</h3>
            <p className="text-sm text-muted-foreground">Revoke or restore access for members of this org.</p>
          </div>
        </div>
        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members found.</p>
        ) : (
          <div className="divide-y divide-border">
            {memberships.map((m) => (
              <div key={m.user_id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{m.users?.name || m.users?.email || "User"}</p>
                  <p className="text-xs text-muted-foreground">{m.role}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={m.status === "active" ? "success" : "error"}>
                    {m.status}
                  </Badge>
                  {m.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateAccess(m.user_id, "revoked")}
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove access
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => updateAccess(m.user_id, "active")}
                    >
                      Restore access
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Danger zone */}
      <Card className="p-6 mt-8 border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10">
        <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
          <div>
            <h3 className="text-red-700 dark:text-red-300 font-semibold">Danger Zone</h3>
            <p className="text-sm text-red-700/80 dark:text-red-200/80">
              Cancel billing or permanently delete this organization. Deletion removes all data.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button
              variant="secondary"
              onClick={cancelSubscription}
              isLoading={isCancelling}
            >
              Cancel Subscription
            </Button>
            <Button
              variant="ghost"
              className="text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/30"
              onClick={deleteOrganization}
              isLoading={isDeleting}
            >
              Delete Organization
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

