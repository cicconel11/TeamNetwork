"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { EnterpriseInviteForm } from "@/components/enterprise/EnterpriseInviteForm";
import { EnterpriseInviteList } from "@/components/enterprise/EnterpriseInviteList";
import { BulkInviteUploader } from "@/components/enterprise/BulkInviteUploader";

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface Invite {
  id: string;
  enterprise_id: string;
  organization_id: string;
  organization_name: string;
  code: string;
  token: string;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function EnterpriseInvitesPage() {
  const params = useParams();
  const enterpriseSlug = params.enterpriseSlug as string;

  const [enterpriseId, setEnterpriseId] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInvites = useCallback(async (entId: string) => {
    try {
      const res = await fetch(`/api/enterprise/${entId}/invites`);
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites || []);
      }
    } catch (err) {
      console.error("Error fetching invites:", err);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get enterprise info
        const enterpriseRes = await fetch(`/api/enterprise/by-slug/${enterpriseSlug}`);
        if (!enterpriseRes.ok) {
          setError("Failed to load enterprise");
          return;
        }
        const enterpriseData = await enterpriseRes.json();
        setEnterpriseId(enterpriseData.id);

        // Get organizations
        const orgsRes = await fetch(`/api/enterprise/${enterpriseData.id}/organizations`);
        if (orgsRes.ok) {
          const orgsData = await orgsRes.json();
          setOrganizations(orgsData.organizations || []);
        }

        // Get invites
        await fetchInvites(enterpriseData.id);
      } catch (err) {
        console.error("Error loading data:", err);
        setError("Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [enterpriseSlug, fetchInvites]);

  const handleInviteCreated = () => {
    setShowCreateForm(false);
    setShowBulkUpload(false);
    if (enterpriseId) {
      fetchInvites(enterpriseId);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    if (!enterpriseId) return;

    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/invites/${inviteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoked: true }),
      });

      if (res.ok) {
        setInvites(invites.map((i) =>
          i.id === inviteId ? { ...i, revoked_at: new Date().toISOString() } : i
        ));
      }
    } catch (err) {
      console.error("Error revoking invite:", err);
    }
  };

  const handleDelete = async (inviteId: string) => {
    if (!enterpriseId) return;

    if (!confirm("Are you sure you want to delete this invite?")) return;

    try {
      const res = await fetch(`/api/enterprise/${enterpriseId}/invites/${inviteId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setInvites(invites.filter((i) => i.id !== inviteId));
      }
    } catch (err) {
      console.error("Error deleting invite:", err);
    }
  };

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
        actions={
          !showCreateForm && !showBulkUpload && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowBulkUpload(true)}>
                <UploadIcon className="h-4 w-4" />
                Bulk Import
              </Button>
              <Button onClick={() => setShowCreateForm(true)}>
                <PlusIcon className="h-4 w-4" />
                Create Invite
              </Button>
            </div>
          )
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
          <p className="text-2xl font-bold text-foreground font-mono">{organizations.length}</p>
          <p className="text-sm text-muted-foreground">Organizations</p>
        </Card>
      </div>

      {/* Create Form */}
      {showCreateForm && enterpriseId && (
        <div className="mb-6">
          <EnterpriseInviteForm
            enterpriseId={enterpriseId}
            organizations={organizations}
            onInviteCreated={handleInviteCreated}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {/* Bulk Upload */}
      {showBulkUpload && enterpriseId && (
        <div className="mb-6">
          <BulkInviteUploader
            enterpriseId={enterpriseId}
            organizations={organizations}
            onUploaded={handleInviteCreated}
            onCancel={() => setShowBulkUpload(false)}
          />
        </div>
      )}

      {/* Invites List */}
      <EnterpriseInviteList
        invites={invites}
        onRevoke={handleRevoke}
        onDelete={handleDelete}
        groupByOrg={true}
      />
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
