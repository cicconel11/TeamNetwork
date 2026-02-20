"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { EnterpriseInviteForm } from "@/components/enterprise/EnterpriseInviteForm";
import type { CreatedInvite } from "@/components/enterprise/EnterpriseInviteForm";
import { EnterpriseInviteList } from "@/components/enterprise/EnterpriseInviteList";
import { BulkInviteUploader } from "@/components/enterprise/BulkInviteUploader";
import { InviteSuccessModal } from "@/components/enterprise/InviteSuccessModal";

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface Invite {
  id: string;
  enterprise_id: string;
  organization_id: string | null;
  organization_name: string | null;
  code: string;
  token: string;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  is_enterprise_wide?: boolean;
}

interface InvitesClientProps {
  enterpriseId: string;
}

export function InvitesClient({ enterpriseId }: InvitesClientProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEnterpriseWideForm, setShowEnterpriseWideForm] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);
  const searchParams = useSearchParams();
  const preselectedOrgId = searchParams.get("org");
  const [filterOrgId, setFilterOrgId] = useState<string>("all");
  const [adminCount, setAdminCount] = useState<number>(0);
  const [adminLimit, setAdminLimit] = useState<number>(12);

  const fetchInvites = useCallback(async (entId: string) => {
    try {
      const res = await fetch(`/api/enterprise/${entId}/invites`);
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites || []);
        if (typeof data.adminCount === "number") {
          setAdminCount(data.adminCount);
        }
        if (typeof data.adminLimit === "number") {
          setAdminLimit(data.adminLimit);
        }
      }
    } catch {
      setError("Failed to fetch invites");
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch organizations and invites in parallel
        const [orgsRes, invitesRes] = await Promise.all([
          fetch(`/api/enterprise/${enterpriseId}/organizations`),
          fetch(`/api/enterprise/${enterpriseId}/invites`),
        ]);

        if (orgsRes.ok) {
          const orgsData = await orgsRes.json();
          setOrganizations(orgsData.organizations || []);
        }

        if (invitesRes.ok) {
          const invitesData = await invitesRes.json();
          setInvites(invitesData.invites || []);
          if (typeof invitesData.adminCount === "number") {
            setAdminCount(invitesData.adminCount);
          }
          if (typeof invitesData.adminLimit === "number") {
            setAdminLimit(invitesData.adminLimit);
          }
        }
      } catch {
        setError("Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [enterpriseId, fetchInvites]);

  useEffect(() => {
    if (preselectedOrgId && organizations.some(o => o.id === preselectedOrgId)) {
      setShowCreateForm(true);
    }
  }, [preselectedOrgId, organizations]);

  const handleInviteCreated = (invite?: CreatedInvite) => {
    if (invite) {
      setCreatedInvite(invite);
    }
    setShowCreateForm(false);
    setShowEnterpriseWideForm(false);
    setShowBulkUpload(false);
    if (enterpriseId) {
      fetchInvites(enterpriseId);
    }
  };

  const handleCloseSuccessModal = () => {
    setCreatedInvite(null);
  };

  const handleCreateAnother = () => {
    setCreatedInvite(null);
    setShowCreateForm(true);
  };

  const handleRevoke = async (inviteId: string) => {
    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/invites/${inviteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoked: true }),
      });

      if (res.ok) {
        setInvites((prev) =>
          prev.map((i) =>
            i.id === inviteId ? { ...i, revoked_at: new Date().toISOString() } : i
          )
        );
      }
    } catch {
      setError("Failed to revoke invite");
    }
  };

  const handleDelete = async (inviteId: string) => {
    if (!confirm("Are you sure you want to delete this invite?")) return;

    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/invites/${inviteId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      }
    } catch {
      setError("Failed to delete invite");
    }
  };

  const enterpriseWideInvites = invites.filter(i => i.organization_id === null);
  const orgSpecificInvites = invites.filter(i => i.organization_id !== null);
  const filteredOrgInvites = filterOrgId === "all"
    ? orgSpecificInvites
    : orgSpecificInvites.filter(i => i.organization_id === filterOrgId);

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Invites" description="Loading..." />
        <Card className="p-8">
          <div className="flex items-center justify-center">
            <LoadingSpinner className="h-8 w-8 text-purple-600" />
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Invites" />
        <Card className="p-8 text-center">
          <p className="text-red-600">{error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Invites"
        description={`Manage invite codes across ${organizations.length} organizations`}
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <p className="text-2xl font-bold text-foreground font-mono">{invites.length}</p>
          <p className="text-sm text-muted-foreground">Total Invites</p>
        </Card>
        <Card className="p-5">
          <p className="text-2xl font-bold text-foreground font-mono">
            {invites.filter((i) => !i.revoked_at && (!i.expires_at || new Date(i.expires_at) > new Date())).length}
          </p>
          <p className="text-sm text-muted-foreground">Active Invites</p>
        </Card>
        <Card className="p-5">
          <p className="text-2xl font-bold text-foreground font-mono">{enterpriseWideInvites.length}</p>
          <p className="text-sm text-muted-foreground">Enterprise-wide</p>
        </Card>
        <Card className="p-5">
          <p className={`text-2xl font-bold font-mono ${adminCount >= adminLimit ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
            {adminCount}/{adminLimit}
          </p>
          <p className="text-sm text-muted-foreground">Admins</p>
        </Card>
      </div>

      {/* Success Modal */}
      {createdInvite && (
        <div className="mb-6">
          <InviteSuccessModal
            invite={createdInvite}
            onClose={handleCloseSuccessModal}
            onCreateAnother={handleCreateAnother}
          />
        </div>
      )}

      {/* ━━ Enterprise-wide Invites ━━━━━━━━━━━━━━━━━━━ */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Enterprise-wide Invites</h3>
            <p className="text-sm text-muted-foreground">
              Invites that let users choose which organization to join
            </p>
          </div>
          {!showEnterpriseWideForm && !createdInvite && enterpriseId && (
            <Button size="sm" onClick={() => setShowEnterpriseWideForm(true)}>
              <PlusIcon className="h-4 w-4" />
              Create Enterprise Invite
            </Button>
          )}
        </div>

        {showEnterpriseWideForm && !createdInvite && enterpriseId && (
          <div className="mb-4">
            <EnterpriseInviteForm
              enterpriseId={enterpriseId}
              organizations={organizations}
              isEnterpriseWide
              onInviteCreated={handleInviteCreated}
              onCancel={() => setShowEnterpriseWideForm(false)}
            />
          </div>
        )}

        {enterpriseWideInvites.length > 0 ? (
          <EnterpriseInviteList
            invites={enterpriseWideInvites}
            onRevoke={handleRevoke}
            onDelete={handleDelete}
            groupByOrg={false}
          />
        ) : (
          !showEnterpriseWideForm && (
            <Card className="p-6 text-center text-muted-foreground text-sm">
              No enterprise-wide invites yet. Create one to let users choose which organization to join.
            </Card>
          )
        )}
      </div>

      {/* ━━ Organization Invites ━━━━━━━━━━━━━━━━━━━━━━ */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Organization Invites</h3>
            <p className="text-sm text-muted-foreground">
              Invites for specific organizations
            </p>
          </div>
          {!showCreateForm && !showBulkUpload && !createdInvite && enterpriseId && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowBulkUpload(true)}>
                <UploadIcon className="h-4 w-4" />
                Bulk Import
              </Button>
              <Button size="sm" onClick={() => setShowCreateForm(true)}>
                <PlusIcon className="h-4 w-4" />
                Create Org Invite
              </Button>
            </div>
          )}
        </div>

        {/* Create Form */}
        {showCreateForm && !createdInvite && enterpriseId && (
          <div className="mb-4">
            <EnterpriseInviteForm
              enterpriseId={enterpriseId}
              organizations={organizations}
              defaultOrgId={preselectedOrgId || undefined}
              onInviteCreated={handleInviteCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        )}

        {/* Bulk Upload */}
        {showBulkUpload && enterpriseId && (
          <div className="mb-4">
            <BulkInviteUploader
              enterpriseId={enterpriseId}
              organizations={organizations}
              onUploaded={handleInviteCreated}
              onCancel={() => setShowBulkUpload(false)}
            />
          </div>
        )}

        {/* Org Filter */}
        {!showCreateForm && !showBulkUpload && orgSpecificInvites.length > 0 && (
          <div className="mb-4 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Filter by organization:</span>
            <select
              value={filterOrgId}
              onChange={(e) => setFilterOrgId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">All Organizations</option>
              {organizations.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Org Invites List */}
        {orgSpecificInvites.length > 0 ? (
          <EnterpriseInviteList
            invites={filteredOrgInvites}
            onRevoke={handleRevoke}
            onDelete={handleDelete}
            groupByOrg={filterOrgId === "all"}
          />
        ) : (
          !showCreateForm && !showBulkUpload && (
            <Card className="p-6 text-center text-muted-foreground text-sm">
              No organization-specific invites yet.
            </Card>
          )
        )}
      </div>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
      />
    </svg>
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
