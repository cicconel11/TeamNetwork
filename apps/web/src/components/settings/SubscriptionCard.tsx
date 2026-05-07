"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Select } from "@/components/ui";
import type { AlumniBucket } from "@/types/database";
import type { SubscriptionInfo } from "@/types/subscription";
import { ALUMNI_LIMITS } from "@/lib/alumni-quota";

interface SubscriptionCardProps {
  orgId: string;
  quota: SubscriptionInfo | null;
  isLoadingQuota: boolean;
  onQuotaRefresh: () => void;
}

const BUCKET_OPTIONS: { value: AlumniBucket; label: string; limit: number | null }[] = [
  { value: "0-250", label: "0\u2013250 alumni", limit: ALUMNI_LIMITS["0-250"] },
  { value: "251-500", label: "251\u2013500 alumni", limit: ALUMNI_LIMITS["251-500"] },
  { value: "501-1000", label: "501\u20131,000 alumni", limit: ALUMNI_LIMITS["501-1000"] },
  { value: "1001-2500", label: "1,001\u20132,500 alumni", limit: ALUMNI_LIMITS["1001-2500"] },
  { value: "2500-5000", label: "2,500\u20135,000 alumni", limit: ALUMNI_LIMITS["2500-5000"] },
  { value: "5000+", label: "5,000+ (contact us)", limit: ALUMNI_LIMITS["5000+"] },
];

export function SubscriptionCard({ orgId, quota, isLoadingQuota, onQuotaRefresh }: SubscriptionCardProps) {
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [selectedBucket, setSelectedBucket] = useState<AlumniBucket>(quota?.bucket ?? "0-250");
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">("month");
  const [isUpdatingPlan, setIsUpdatingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const isEnterpriseManaged = quota?.isEnterpriseManaged === true || quota?.status === "enterprise_managed";
  const currentPlanLabel = isEnterpriseManaged ? "Enterprise pooled quota" : (quota?.bucket || "none");

  // Sync bucket when quota loads
  useEffect(() => {
    if (quota?.bucket && !isEnterpriseManaged) setSelectedBucket(quota.bucket);
  }, [isEnterpriseManaged, quota?.bucket]);

  const handleUpdatePlan = async () => {
    if (isEnterpriseManaged) {
      setPlanError("This organization uses enterprise-managed billing. Update alumni capacity from the enterprise billing page.");
      return;
    }

    const targetLimit = ALUMNI_LIMITS[selectedBucket];
    if (
      quota &&
      targetLimit !== null &&
      quota.alumniCount > targetLimit
    ) {
      setPlanError(tSettings("subscription.downgradeDisabled"));
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
        throw new Error(data.error || tSettings("subscription.unableToUpdate"));
      }
      if (data.url) {
        window.location.href = data.url as string;
        return;
      }
      setPlanSuccess(tSettings("subscription.updated"));
      onQuotaRefresh();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : tSettings("subscription.unableToUpdate"));
    } finally {
      setIsUpdatingPlan(false);
    }
  };

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground">{tSettings("subscription.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {tSettings("subscription.description")}
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
          <p className="text-sm text-muted-foreground">{tSettings("subscription.currentPlan")}</p>
          <p className="text-lg font-semibold text-foreground">
            {isLoadingQuota ? tCommon("loading") : currentPlanLabel}
          </p>
          {!isEnterpriseManaged && !quota?.stripeSubscriptionId && (
            <p className="text-xs text-amber-600">{tSettings("subscription.billingNotConnected")}</p>
          )}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{tSettings("subscription.alumniUsed")}</p>
          <p className="text-lg font-semibold text-foreground">
            {isLoadingQuota
              ? tCommon("loading")
              : quota?.alumniLimit === null
                ? `${quota?.alumniCount ?? 0} / ${tCommon("unlimited")}`
                : `${quota?.alumniCount ?? 0} / ${quota?.alumniLimit ?? 0}`}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{tSettings("subscription.remaining")}</p>
          <p className="text-lg font-semibold text-foreground">
            {isLoadingQuota
              ? tCommon("loading")
              : quota?.alumniLimit === null
                ? tCommon("unlimited")
                : Math.max((quota?.alumniLimit ?? 0) - (quota?.alumniCount ?? 0), 0)}
          </p>
        </div>
      </div>

      {quota && quota.alumniLimit !== null && quota.alumniCount >= quota.alumniLimit && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
          {tSettings("subscription.planLimitReached")}
        </div>
      )}

      {isEnterpriseManaged && (
        <div className="mt-4 p-3 rounded-xl bg-muted/60 text-sm text-muted-foreground">
          Alumni capacity is pooled across the enterprise. Manage billing and bucket changes from the enterprise dashboard.
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-2">
          <Select
            label={tSettings("subscription.alumniPlan")}
            value={selectedBucket}
            onChange={(e) => setSelectedBucket(e.target.value as AlumniBucket)}
            disabled={isLoadingQuota || isEnterpriseManaged}
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
            {isEnterpriseManaged
              ? "Enterprise-managed organizations inherit pooled alumni capacity."
              : quota?.stripeSubscriptionId && quota?.stripeCustomerId
              ? tSettings("subscription.downgradeDisabled")
              : tSettings("subscription.selectPlan")}
          </p>
        </div>
        <div className="space-y-2">
          <Select
            label={tSettings("subscription.billingInterval")}
            value={selectedInterval}
            onChange={(e) => setSelectedInterval(e.target.value as "month" | "year")}
            disabled={isLoadingQuota || isEnterpriseManaged}
            options={[
              { value: "month", label: tSettings("subscription.monthly") },
              { value: "year", label: tSettings("subscription.yearly") },
            ]}
          />
        </div>
        <div className="flex gap-3 flex-wrap items-end">
          <Button
            onClick={handleUpdatePlan}
            isLoading={isUpdatingPlan}
            disabled={isLoadingQuota || !quota || isEnterpriseManaged || (selectedBucket === quota.bucket && !!quota.stripeSubscriptionId)}
          >
            {tSettings("subscription.updatePlan")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
