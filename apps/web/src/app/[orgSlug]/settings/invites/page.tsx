"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card } from "@/components/ui";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { SubscriptionInfo } from "@/types/subscription";
import { OrgInvitePanel } from "@/components/settings/OrgInvitePanel";
import { MembershipPanel } from "@/components/settings/MembershipPanel";
import { BulkOrgInviteForm } from "@/components/settings/BulkOrgInviteForm";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import { DangerZoneCard } from "@/components/settings/DangerZoneCard";

export default function InvitesPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [quota, setQuota] = useState<SubscriptionInfo | null>(null);
  const [isLoadingQuota, setIsLoadingQuota] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);
  const [isSavingToggle, setIsSavingToggle] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvalError, setApprovalError] = useState<string | null>(null);

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
      // Cast needed: require_invite_approval exists in DB but not yet in generated types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orgs, error: orgError } = await (supabase as any)
        .from("organizations")
        .select("id, name, require_invite_approval")
        .eq("slug", orgSlug)
        .limit(1);

      const org = orgs?.[0] as { id: string; name: string; require_invite_approval?: boolean } | undefined;
      if (org && !orgError) {
        setOrgId(org.id);
        setOrgName(org.name);
        setRequireApproval(org.require_invite_approval ?? false);
        void loadQuota(org.id);

        // Fetch pending member count
        const { count } = await supabase
          .from("user_organization_roles")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("status", "pending");
        setPendingCount(count ?? 0);
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
        <PageHeader title={tSettings("title")} description={tCommon("loading")} />
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const handleToggleApproval = async (checked: boolean) => {
    if (!orgId) return;
    setIsSavingToggle(true);
    setApprovalError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require_invite_approval: checked }),
      });

      if (!res.ok) {
        const data = await res.json();
        setApprovalError(data.error || "Failed to update approval setting");
        return;
      }

      setRequireApproval(checked);
    } catch {
      setApprovalError("Failed to update approval setting");
    } finally {
      setIsSavingToggle(false);
    }
  };

  if (!orgId) return null;

  return (
    <div>
      <PageHeader
        title={tSettings("title")}
        description={tSettings("description")}
        backHref={`/${orgSlug}`}
        actions={
          !showInviteForm && !showBulkForm && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowBulkForm(true)}>
                <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {tSettings("bulkImport")}
              </Button>
              <Button data-testid="invite-open-form" onClick={() => setShowInviteForm(true)}>
                <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {tSettings("createInvite")}
              </Button>
            </div>
          )
        }
      />

      <SubscriptionCard
        orgId={orgId}
        quota={quota}
        isLoadingQuota={isLoadingQuota}
        onQuotaRefresh={handleQuotaRefresh}
      />

      {/* Invite Approval Settings */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">{tSettings("requireApproval")}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {tSettings("requireApprovalDesc")}
            </p>
          </div>
          <ToggleSwitch
            checked={requireApproval}
            onChange={handleToggleApproval}
            disabled={isSavingToggle}
            label={tSettings("requireApprovalLabel")}
          />
        </div>
        {approvalError && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {approvalError}
          </div>
        )}
        <div className={`mt-4 flex items-center justify-between p-3 rounded-lg ${pendingCount > 0 ? "bg-amber-50 dark:bg-amber-900/20" : "bg-muted/50"}`}>
          <span className={`text-sm ${pendingCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            {pendingCount > 0
              ? tSettings("pendingApprovalsCount", { count: pendingCount })
              : tCommon("noPendingApprovals")}
          </span>
          <Link
            href={`/${orgSlug}/settings/approvals`}
            className={`text-sm font-medium hover:underline ${pendingCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
          >
            {pendingCount > 0 ? tSettings("reviewPending") : tSettings("viewApprovals")}
          </Link>
        </div>
      </Card>

      {showBulkForm && (
        <BulkOrgInviteForm
          orgId={orgId}
          onComplete={() => {
            setShowBulkForm(false);
            window.location.reload();
          }}
          onCancel={() => setShowBulkForm(false)}
        />
      )}

      <OrgInvitePanel
        orgId={orgId}
        quotaLimit={quota?.alumniLimit ?? null}
        alumniCount={quota?.alumniCount ?? 0}
        showForm={showInviteForm}
        onShowFormChange={setShowInviteForm}
        onAlumniInviteCreated={handleQuotaRefresh}
        orgRequireApproval={requireApproval}
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
