"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card, Input, Select, Badge } from "@/components/ui";
import { QRCodeDisplay } from "@/components/invites";
import type { AlumniBucket } from "@/types/database";
import { ALUMNI_LIMITS } from "@/lib/alumni-quota";

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

interface Membership {
  user_id: string;
  role: string;
  status: "active" | "revoked" | "pending";
  users?: { name: string | null; email: string | null };
}

interface SubscriptionInfo {
  bucket: AlumniBucket;
  alumniLimit: number | null;
  alumniCount: number;
  remaining: number | null;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}

const BUCKET_OPTIONS: { value: AlumniBucket; label: string; limit: number | null }[] = [
  { value: "none", label: "No alumni access (0)", limit: ALUMNI_LIMITS.none },
  { value: "0-200", label: "0–200 alumni", limit: ALUMNI_LIMITS["0-200"] },
  { value: "201-600", label: "201–600 alumni", limit: ALUMNI_LIMITS["201-600"] },
  { value: "601-1500", label: "601–1500 alumni", limit: ALUMNI_LIMITS["601-1500"] },
  { value: "1500+", label: "1500+ (contact us)", limit: ALUMNI_LIMITS["1500+"] },
];

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
  const [showQR, setShowQR] = useState<string | null>(null);
  const [quota, setQuota] = useState<SubscriptionInfo | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [isLoadingQuota, setIsLoadingQuota] = useState(true);
  const [isUpdatingPlan, setIsUpdatingPlan] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<AlumniBucket>("none");

  // New invite form state
  const [showForm, setShowForm] = useState(false);
  const [newRole, setNewRole] = useState<"active_member" | "admin" | "alumni">("active_member");
  const [newUses, setNewUses] = useState<string>("");
  const [newExpires, setNewExpires] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadQuota = useCallback(async (organizationId: string) => {
    setIsLoadingQuota(true);
    setPlanError(null);
    setPlanSuccess(null);

    try {
      const res = await fetch(`/api/organizations/${organizationId}/subscription`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setPlanError(data.error || "Unable to load subscription details");
      } else {
        setQuota(data as SubscriptionInfo);
        setSelectedBucket((data as SubscriptionInfo).bucket);
      }
    } catch {
      setPlanError("Unable to load subscription details");
    } finally {
      setIsLoadingQuota(false);
    }
  }, []);

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
        void loadQuota(org.id);

        // Get invites
        const { data: inviteData, error: inviteError } = await supabase
          .from("organization_invites")
          .select("*")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false });

        if (inviteError) {
          console.error("Failed to fetch invites:", inviteError.message);
        }

        setInvites(inviteData || []);

        // Get memberships
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
              status: m.status as "active" | "revoked" | "pending",
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
  }, [orgSlug, loadQuota]);

  useEffect(() => {
    if (quota?.bucket) {
      setSelectedBucket(quota.bucket);
    }
  }, [quota?.bucket]);

  const handleCreateInvite = async () => {
    if (!orgId) return;
    if (
      newRole === "alumni" &&
      quota &&
      quota.alumniLimit !== null &&
      quota.alumniCount >= quota.alumniLimit
    ) {
      setError("Alumni quota reached. Upgrade your plan to invite more alumni.");
      return;
    }

    setIsCreating(true);
    setError(null);

    const supabase = createClient();
    
    // Use server-side RPC to generate invite (secure code generation)
    const usesRemaining = newUses ? parseInt(newUses) : null;
    const expiresAt = newExpires ? new Date(newExpires).toISOString() : null;

    const { data, error: rpcError } = await supabase.rpc("create_org_invite", {
      p_organization_id: orgId,
      p_role: newRole,
      p_uses: usesRemaining,
      p_expires_at: expiresAt,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else if (data) {
      // RPC returns the created invite
      setInvites([data as Invite, ...invites]);
      setShowForm(false);
      setNewRole("active_member");
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

  const handleRevokeInvite = async (inviteId: string) => {
    const supabase = createClient();
    await supabase
      .from("organization_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId);

    setInvites(invites.map(i => 
      i.id === inviteId ? { ...i, revoked_at: new Date().toISOString() } : i
    ));
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

  const handleUpdatePlan = async () => {
    if (!orgId) return;
    if (!quota?.stripeSubscriptionId || !quota.stripeCustomerId) {
      setPlanError("Billing is not set up for this organization yet.");
      return;
    }
    const targetLimit = ALUMNI_LIMITS[selectedBucket];
    if (
      quota &&
      targetLimit !== null &&
      quota.alumniCount > targetLimit
    ) {
      setPlanError("You are above the limit for that plan. Choose a larger bucket first.");
      return;
    }

    setIsUpdatingPlan(true);
    setPlanError(null);
    setPlanSuccess(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumniBucket: selectedBucket }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to update subscription");
      }
      setQuota(data as SubscriptionInfo);
      setPlanSuccess("Subscription updated.");
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unable to update subscription");
    } finally {
      setIsUpdatingPlan(false);
    }
  };

  const openBillingPortal = async () => {
    if (!orgId) return;
    if (!quota?.stripeCustomerId) {
      setPlanError("Billing is not set up for this organization yet.");
      return;
    }
    setPlanError(null);
    setPlanSuccess(null);
    setIsOpeningPortal(true);
    try {
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Unable to open billing portal");
      }
      window.location.href = data.url as string;
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unable to open billing portal");
      setIsOpeningPortal(false);
    }
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

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const isRevoked = (revokedAt: string | null) => {
    return !!revokedAt;
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

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "warning";
      case "alumni": return "muted";
      default: return "primary";
    }
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

      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-foreground">Subscription & Alumni Quota</h3>
            <p className="text-sm text-muted-foreground">
              Alumni additions are capped by your current plan. Upgrade to add more alumni.
            </p>
          </div>
          {quota?.status && (
            <Badge variant="muted" className="uppercase tracking-wide">
              {quota.status}
            </Badge>
          )}
        </div>

        {planError && (
          <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {planError}
          </div>
        )}
        {planSuccess && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm">
            {planSuccess}
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Current alumni plan</p>
            <p className="text-lg font-semibold text-foreground">
              {isLoadingQuota ? "Loading..." : quota?.bucket || "none"}
            </p>
            {!quota?.stripeSubscriptionId && (
              <p className="text-xs text-amber-600">Billing not connected</p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Alumni used</p>
            <p className="text-lg font-semibold text-foreground">
              {isLoadingQuota
                ? "Loading..."
                : quota?.alumniLimit === null
                  ? `${quota?.alumniCount ?? 0} / Unlimited`
                  : `${quota?.alumniCount ?? 0} / ${quota?.alumniLimit ?? 0}`}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Remaining</p>
            <p className="text-lg font-semibold text-foreground">
              {isLoadingQuota
                ? "Loading..."
                : quota?.alumniLimit === null
                  ? "Unlimited"
                  : Math.max((quota?.alumniLimit ?? 0) - (quota?.alumniCount ?? 0), 0)}
            </p>
          </div>
        </div>

        {quota && quota.alumniLimit !== null && quota.alumniCount >= quota.alumniLimit && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
            Alumni limit reached. Upgrade to add more alumni.
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr]">
          <div className="space-y-2">
            <Select
              label="Alumni plan"
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value as AlumniBucket)}
              disabled={isLoadingQuota || !quota?.stripeSubscriptionId || !quota?.stripeCustomerId}
              options={BUCKET_OPTIONS.map((option) => ({
                ...option,
                disabled:
                  (quota
                    ? (option.limit !== null && quota.alumniCount > option.limit) ||
                      (option.value === "1500+" && quota.bucket !== "1500+")
                    : option.value === "1500+") || false,
              }))}
            />
            <p className="text-xs text-muted-foreground">
              {quota?.stripeSubscriptionId && quota?.stripeCustomerId
                ? "Downgrades are disabled if your alumni count exceeds the plan limit."
                : "Billing is not set up yet for this organization."}
            </p>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <Button
              onClick={handleUpdatePlan}
              isLoading={isUpdatingPlan}
              disabled={
                isLoadingQuota ||
                !quota ||
                !quota.stripeSubscriptionId ||
                !quota.stripeCustomerId
              }
            >
              Update plan
            </Button>
            <Button
              variant="secondary"
              onClick={openBillingPortal}
              isLoading={isOpeningPortal}
              disabled={isLoadingQuota || !quota || !quota.stripeCustomerId}
            >
              Billing portal
            </Button>
          </div>
        </div>
      </Card>

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
          {newRole === "alumni" && quota && quota.alumniLimit !== null && quota.alumniCount >= quota.alumniLimit && (
            <p className="text-xs text-amber-600">
              Alumni limit reached for your plan. Upgrade above to add more alumni invites.
            </p>
          )}
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
            const revoked = isRevoked(invite.revoked_at);
            const exhausted = invite.uses_remaining !== null && invite.uses_remaining <= 0;
            const invalid = expired || exhausted || revoked;
            const inviteLink = getInviteLink(invite);

            return (
              <Card key={invite.id} className={`p-6 ${invalid ? "opacity-60" : ""}`}>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div
                        className="font-mono text-xl font-bold tracking-wider cursor-pointer hover:text-emerald-500 transition-colors"
                        onClick={() => copyToClipboard(invite.code, `code-${invite.id}`)}
                        title="Click to copy code"
                      >
                        {invite.code}
                        {copied === `code-${invite.id}` && (
                          <span className="ml-2 text-xs text-emerald-500 font-normal">Copied!</span>
                        )}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant={getRoleBadgeVariant(invite.role)}>
                          {getRoleLabel(invite.role)}
                        </Badge>
                        {expired && <Badge variant="error">Expired</Badge>}
                        {exhausted && <Badge variant="error">No uses left</Badge>}
                        {revoked && <Badge variant="error">Revoked</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyToClipboard(inviteLink, `link-${invite.id}`)}
                        className="text-emerald-600 hover:text-emerald-700"
                      >
                        <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                        </svg>
                        {copied === `link-${invite.id}` ? "Copied!" : "Copy Link"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowQR(showQR === invite.id ? null : invite.id)}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                        </svg>
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
                      {!revoked && !expired && !exhausted && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeInvite(invite.id)}
                          className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        >
                          Revoke
                        </Button>
                      )}
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
                  
                  {/* QR Code Section */}
                  {showQR === invite.id && (
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
                  <p className="text-xs text-muted-foreground">{getRoleLabel(m.role)}</p>
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
