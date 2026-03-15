"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import type { SubscriptionInfo } from "@/types/subscription";
import { OrgInvitePanel } from "@/components/settings/OrgInvitePanel";
import { MembershipPanel } from "@/components/settings/MembershipPanel";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import { DangerZoneCard } from "@/components/settings/DangerZoneCard";

export default function InvitesPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [quota, setQuota] = useState<SubscriptionInfo | null>(null);
  const [isLoadingQuota, setIsLoadingQuota] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const loadQuota = useCallback(async (organizationId: string) => {
    setIsLoadingQuota(true);

    try {
      const res = await fetch(`/api/organizations/${organizationId}/subscription`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        setQuota(data as SubscriptionInfo);
      }
    } catch {
      // Quota load failure is non-fatal — SubscriptionCard shows its own error state
    } finally {
      setIsLoadingQuota(false);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
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
      }

      setIsLoading(false);
    };

    fetchData();
  }, [orgSlug, loadQuota]);

  const handleQuotaRefresh = useCallback(() => {
    if (orgId) loadQuota(orgId);
  }, [orgId, loadQuota]);

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

  if (!orgId) return null;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage invites, subscriptions, and organization access"
        backHref={`/${orgSlug}`}
        actions={
          !showInviteForm && (
            <Button onClick={() => setShowInviteForm(true)}>
              <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Invite
            </Button>
          )
        }
      />

      <SubscriptionCard
        orgId={orgId}
        quota={quota}
        isLoadingQuota={isLoadingQuota}
        onQuotaRefresh={handleQuotaRefresh}
      />

      <OrgInvitePanel
        orgId={orgId}
        quotaLimit={quota?.alumniLimit ?? null}
        alumniCount={quota?.alumniCount ?? 0}
        showForm={showInviteForm}
        onShowFormChange={setShowInviteForm}
        onAlumniInviteCreated={handleQuotaRefresh}
      />

      <MembershipPanel
        orgId={orgId}
        quota={quota}
        onAlumniRoleChanged={handleQuotaRefresh}
      />

      <DangerZoneCard
        orgId={orgId}
        orgName={orgName}
        orgSlug={orgSlug}
        subscriptionStatus={quota?.status}
        stripeCustomerId={quota?.stripeCustomerId}
        currentPeriodEnd={quota?.currentPeriodEnd}
        onSubscriptionCancelled={handleQuotaRefresh}
      />
    </div>
  );
}
