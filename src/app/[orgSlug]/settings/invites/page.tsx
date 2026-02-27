"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card, Input, Select, Badge } from "@/components/ui";
import { QRCodeDisplay } from "@/components/invites";
import type { AlumniBucket } from "@/types/database";
import { ALUMNI_LIMITS } from "@/lib/alumni-quota";
import { buildInviteLink } from "@/lib/invites/buildInviteLink";

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
  currentPeriodEnd: string | null;
}

const BUCKET_OPTIONS: { value: AlumniBucket; label: string; limit: number | null }[] = [
  { value: "0-250", label: "0–250 alumni", limit: ALUMNI_LIMITS["0-250"] },
  { value: "251-500", label: "251–500 alumni", limit: ALUMNI_LIMITS["251-500"] },
  { value: "501-1000", label: "501–1,000 alumni", limit: ALUMNI_LIMITS["501-1000"] },
  { value: "1001-2500", label: "1,001–2,500 alumni", limit: ALUMNI_LIMITS["1001-2500"] },
  { value: "2500-5000", label: "2,500–5,000 alumni", limit: ALUMNI_LIMITS["2500-5000"] },
  { value: "5000+", label: "5,000+ (contact us)", limit: ALUMNI_LIMITS["5000+"] },
];

export default function InvitesPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgInvites, setOrgInvites] = useState<Invite[]>([]);
  const [parentInvites, setParentInvites] = useState<ParentInvite[]>([]);
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
  const [selectedBucket, setSelectedBucket] = useState<AlumniBucket>("0-250");
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">("month");

  // New invite form state
  const [showForm, setShowForm] = useState(false);
  const [newRole, setNewRole] = useState<"active_member" | "admin" | "alumni" | "parent">("active_member");
  const [newUses, setNewUses] = useState<string>("");
  const [newExpires, setNewExpires] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [orgName, setOrgName] = useState<string>("");

  // Role change state
  const [roleChangeUserId, setRoleChangeUserId] = useState<string | null>(null);
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [pendingAdminUserId, setPendingAdminUserId] = useState<string | null>(null);

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
        .select("id, name")
        .eq("slug", orgSlug)
        .limit(1);

      const org = orgs?.[0];

      if (org && !orgError) {
        setOrgId(org.id);
        setOrgName(org.name);
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

        setOrgInvites(inviteData || []);

        const { data: parentInviteData, error: parentInviteError } = await (supabase as any)
          .from("parent_invites")
          .select("id,email,code,expires_at,status,created_at")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false });

        if (parentInviteError) {
          console.error("Failed to fetch parent invites:", parentInviteError.message);
        }

        setParentInvites((parentInviteData as ParentInvite[] | null) || []);

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

        setShowForm(false);
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
      setOrgInvites((prev) => [data as Invite, ...prev]);
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

    setOrgInvites((prev) => prev.filter(i => i.id !== inviteId));
  };

  const handleRevokeInvite = async (inviteId: string) => {
    const supabase = createClient();
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

  const handleRevokeParentInvite = async (inviteId: string) => {
    if (!orgId) return;
    const res = await fetch(`/api/organizations/${orgId}/parents/invite/${inviteId}`, {
      method: "PATCH",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to revoke parent invite");
      return;
    }
    setParentInvites((prev) =>
      prev.map((i) =>
        i.id === inviteId ? { ...i, status: "revoked" as const } : i
      )
    );
  };

  const cancelSubscription = async () => {
    if (!orgId) return;
    
    const periodEnd = quota?.currentPeriodEnd 
      ? new Date(quota.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "the end of your billing period";
    
    if (!confirm(`Are you sure you want to cancel your subscription?\n\nYour subscription will remain active until ${periodEnd}. After that, you'll have 30 days of read-only access before the organization is deleted.\n\nYou can resubscribe anytime during this period.`)) {
      return;
    }

    setIsCancelling(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}/cancel-subscription`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to cancel subscription");
      }
      
      const endDate = data.currentPeriodEnd 
        ? new Date(data.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : "the end of your billing period";
      
      alert(`Your subscription has been cancelled.\n\nYou will have access until ${endDate}, followed by 30 days of read-only access.\n\nYou can resubscribe anytime to keep your organization.`);
      
      // Reload to reflect updated status
      if (orgId) loadQuota(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel subscription");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!orgId) return;
    
    // First confirmation
    if (!confirm("WARNING: You are about to permanently delete this organization.\n\nAll data including members, alumni, events, records, and files will be lost forever.\n\nThis action CANNOT be undone.\n\nAre you sure you want to continue?")) {
      return;
    }
    
    // Show second confirmation dialog requiring org name
    setShowDeleteConfirm(true);
  };

  const confirmDeleteOrganization = async () => {
    if (!orgId || !orgName) return;
    
    // Check if the typed name matches the org name or slug
    if (deleteConfirmText !== orgName && deleteConfirmText !== orgSlug) {
      setError(`Please type "${orgName}" or "${orgSlug}" to confirm deletion.`);
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to delete organization");
      }
      
      alert("Your organization has been deleted and your payments have been ended.");
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete organization");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmText("");
    }
  };

  const openBillingPortal = async () => {
    if (!orgId) return;

    setIsOpeningPortal(true);
    setError(null);

    try {
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to open billing portal");
      }
      if (data.url) {
        window.location.href = data.url as string;
        return;
      }
      throw new Error("No billing portal URL returned");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing portal");
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const handleUpdatePlan = async () => {
    if (!orgId) return;
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
      const endpoint = !quota?.stripeSubscriptionId
        ? `/api/organizations/${orgId}/start-checkout`
        : `/api/organizations/${orgId}/subscription`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumniBucket: selectedBucket, interval: selectedInterval }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to update subscription");
      }
      if (data.url) {
        window.location.href = data.url as string;
        return;
      }
      setQuota(data as SubscriptionInfo);
      setPlanSuccess("Subscription updated.");
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Unable to update subscription");
    } finally {
      setIsUpdatingPlan(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const getInviteLink = (invite: InviteItem) => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return buildInviteLink({
      kind: invite.kind,
      baseUrl: base,
      orgId: orgId ?? undefined,
      code: invite.code,
      token: invite.token ?? undefined,
    });
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
    const res = await fetch(`/api/organizations/${orgId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || "Failed to update access");
    } else {
      setMemberships((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, status } : m))
      );
    }
  };

  const canChangeToAlumni = useCallback(() => {
    // Be optimistic if quota hasn't loaded - database will enforce the constraint
    if (!quota) return true;
    if (quota.alumniLimit === null) return true; // unlimited plan
    return quota.remaining !== null && quota.remaining > 0;
  }, [quota]);

  const updateRole = async (userId: string, newRole: "admin" | "active_member" | "alumni" | "parent") => {
    if (!orgId) return;

    // Find current role to check if actually changing
    const currentMember = memberships.find((m) => m.user_id === userId);
    if (currentMember?.role === newRole) return;

    // If promoting to admin, require confirmation
    if (newRole === "admin") {
      setPendingAdminUserId(userId);
      setShowAdminConfirm(true);
      return;
    }

    // Note: Alumni quota is enforced by database trigger - if exceeded, error will be returned

    setIsChangingRole(true);
    setRoleChangeUserId(userId);
    setError(null);

    const res = await fetch(`/api/organizations/${orgId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || "Failed to update role");
    } else {
      setMemberships((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m))
      );
      // Reload quota if changed to/from alumni
      if (newRole === "alumni" || currentMember?.role === "alumni") {
        loadQuota(orgId);
      }
    }

    setIsChangingRole(false);
    setRoleChangeUserId(null);
  };

  const confirmAdminPromotion = async () => {
    if (!orgId || !pendingAdminUserId) return;

    setIsChangingRole(true);
    setRoleChangeUserId(pendingAdminUserId);
    setError(null);

    const res = await fetch(`/api/organizations/${orgId}/members/${pendingAdminUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || "Failed to update role");
    } else {
      setMemberships((prev) =>
        prev.map((m) => (m.user_id === pendingAdminUserId ? { ...m, role: "admin" } : m))
      );
    }

    setIsChangingRole(false);
    setRoleChangeUserId(null);
    setShowAdminConfirm(false);
    setPendingAdminUserId(null);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "warning";
      case "alumni": return "muted";
      case "parent": return "primary";
      default: return "primary";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "admin": return "Admin";
      case "alumni": return "Alumni";
      case "parent": return "Parent";
      case "active_member": return "Active Member";
      case "member": return "Member";
      default: return role;
    }
  };

  const inviteFormLayout = "grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4";

  const allInvites: InviteItem[] = [
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
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Settings" description="Loading..." />
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage invites, subscriptions, and organization access"
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

        <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-2">
            <Select
              label="Alumni plan"
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value as AlumniBucket)}
              disabled={isLoadingQuota}
              options={BUCKET_OPTIONS.map((option) => ({
                ...option,
                disabled:
                  (quota
                    ? (option.limit !== null && quota.alumniCount > option.limit) ||
                      (option.value === "5000+" && quota.bucket !== "5000+")
                    : option.value === "5000+") || false,
              }))}
            />
            <p className="text-xs text-muted-foreground">
              {quota?.stripeSubscriptionId && quota?.stripeCustomerId
                ? "Downgrades are disabled if your alumni count exceeds the plan limit."
                : "Select a plan and click Update to start billing checkout."}
            </p>
          </div>
          <div className="space-y-2">
            <Select
              label="Billing interval"
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value as "month" | "year")}
              disabled={isLoadingQuota}
              options={[
                { value: "month", label: "Monthly" },
                { value: "year", label: "Yearly (save ~17%)" },
              ]}
            />
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <Button
              onClick={handleUpdatePlan}
              isLoading={isUpdatingPlan}
              disabled={isLoadingQuota || !quota || (selectedBucket === quota.bucket && !!quota.stripeSubscriptionId)}
            >
              Update plan
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
          <div className={inviteFormLayout}>
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
                          <div>Expires {formatDate(invite.expires_at)}</div>
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
                      {invite.kind === "parent" && !revoked && !expired && !accepted && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeParentInvite(invite.id)}
                          className="text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        >
                          Revoke
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
          <Button onClick={() => setShowForm(true)}>Create Invite Code</Button>
        </Card>
      )}

      {/* Access control */}
      <Card className="p-6 mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">Access control</h3>
            <p className="text-sm text-muted-foreground">
              Manage roles and access for members of this org.
            </p>
            {quota && (
              <p className="text-xs text-muted-foreground mt-1">
                Alumni slots: {quota.alumniLimit === null
                  ? "Unlimited"
                  : `${quota.remaining ?? 0} remaining (${quota.alumniCount}/${quota.alumniLimit} used)`}
              </p>
            )}
          </div>
        </div>
        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members found.</p>
        ) : (
          <div className="divide-y divide-border">
            {memberships.map((m) => (
              <div key={m.user_id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {m.users?.name || m.users?.email || "User"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{m.users?.email}</p>
                </div>

                {/* Role dropdown - only show for active users */}
                {m.status === "active" ? (
                  <div className="w-36">
                    <Select
                      value={m.role === "member" ? "active_member" : m.role}
                      onChange={(e) =>
                        updateRole(m.user_id, e.target.value as "admin" | "active_member" | "alumni" | "parent")
                      }
                      disabled={isChangingRole && roleChangeUserId === m.user_id}
                      options={[
                        { value: "active_member", label: "Active Member" },
                        { value: "alumni", label: "Alumni", disabled: m.role !== "alumni" && !canChangeToAlumni() },
                        { value: "parent", label: "Parent" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />
                  </div>
                ) : (
                  <Badge variant={getRoleBadgeVariant(m.role)}>
                    {getRoleLabel(m.role)}
                  </Badge>
                )}

                <div className="flex items-center gap-2">
                  <Badge variant={m.status === "active" ? "success" : "error"}>
                    {m.status}
                  </Badge>

                  {isChangingRole && roleChangeUserId === m.user_id && (
                    <svg className="animate-spin h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}

                  {m.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateAccess(m.user_id, "revoked")}
                      className="text-red-600 hover:text-red-700"
                      disabled={isChangingRole && roleChangeUserId === m.user_id}
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

      {/* Billing Management */}
      <Card className="p-6 mt-8 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
          <div>
            <h3 className="font-semibold">Billing Management</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manage payment methods, view invoices, or update your subscription.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={openBillingPortal}
            isLoading={isOpeningPortal}
            disabled={!quota?.stripeCustomerId}
          >
            Manage Billing
          </Button>
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="p-6 mt-8 border border-amber-300 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10">
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="text-amber-800 dark:text-amber-200 font-semibold">Danger Zone</h3>
            <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
              These actions can affect your organization&apos;s access and data.
            </p>
          </div>

          {/* Cancel Subscription Section */}
          <div className="border-t border-amber-300 dark:border-amber-700/50 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h4 className="font-medium text-amber-800 dark:text-amber-200">Cancel Subscription</h4>
                <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                  Your subscription will remain active until the end of your billing period.
                  After that, you&apos;ll have 30 days of read-only access to resubscribe.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={cancelSubscription}
                isLoading={isCancelling}
                disabled={isCancelling || !orgId || quota?.status === "canceling" || quota?.status === "canceled"}
              >
                {quota?.status === "canceling" ? "Cancellation Scheduled" : "Cancel Subscription"}
              </Button>
            </div>
            {quota?.status === "canceling" && quota?.currentPeriodEnd && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                Your subscription will end on {new Date(quota.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
              </p>
            )}
          </div>

          {/* Delete Organization Section */}
          <div className="border-t border-amber-300 dark:border-amber-700/50 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h4 className="font-medium text-amber-800 dark:text-amber-200">Delete Organization</h4>
                <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                  Permanently delete this organization and all its data.
                  This action cannot be undone.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={handleDeleteOrganization}
                isLoading={isDeleting}
                disabled={isDeleting || !orgId}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600"
              >
                Delete Organization
              </Button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
              {error}
            </p>
          )}
        </div>
      </Card>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-amber-700 dark:text-amber-300">
                Confirm Organization Deletion
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                This will permanently delete <strong>{orgName}</strong> and all associated data including:
              </p>
              <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside">
                <li>All members and alumni records</li>
                <li>Events, announcements, and forms</li>
                <li>Files and documents</li>
                <li>Subscription and billing data</li>
              </ul>
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">
                Type <span className="font-mono bg-muted px-1 rounded">{orgName}</span> or <span className="font-mono bg-muted px-1 rounded">{orgSlug}</span> to confirm:
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={`Type "${orgName}" to confirm`}
                className="w-full"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteOrganization}
                disabled={isDeleting || (deleteConfirmText !== orgName && deleteConfirmText !== orgSlug)}
                isLoading={isDeleting}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600"
              >
                Delete Forever
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Admin Promotion Confirmation Modal */}
      {showAdminConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-amber-700 dark:text-amber-300">
                Confirm Admin Promotion
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                You are about to promote{" "}
                <strong>
                  {memberships.find((m) => m.user_id === pendingAdminUserId)?.users?.name ||
                    memberships.find((m) => m.user_id === pendingAdminUserId)?.users?.email ||
                    "this user"}
                </strong>{" "}
                to Admin.
              </p>
              <p className="text-sm text-muted-foreground mt-2">Admins have full access to:</p>
              <ul className="text-sm text-muted-foreground mt-1 list-disc list-inside">
                <li>Organization settings and billing</li>
                <li>Member management and approvals</li>
                <li>All content creation and editing</li>
                <li>Navigation customization</li>
              </ul>
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAdminConfirm(false);
                  setPendingAdminUserId(null);
                }}
                disabled={isChangingRole}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmAdminPromotion}
                isLoading={isChangingRole}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600"
              >
                Promote to Admin
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
