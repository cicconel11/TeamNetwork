"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Button, Card, Input } from "@/components/ui";

interface DangerZoneCardProps {
  orgId: string;
  orgName: string;
  orgSlug: string;
  subscriptionStatus: string | undefined;
  stripeCustomerId: string | null | undefined;
  currentPeriodEnd: string | null | undefined;
  onSubscriptionCancelled: () => void;
}

export function DangerZoneCard({
  orgId,
  orgName,
  orgSlug,
  subscriptionStatus,
  stripeCustomerId,
  currentPeriodEnd,
  onSubscriptionCancelled,
}: DangerZoneCardProps) {
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const formatDate = (dateStr: string) =>
    format.dateTime(new Date(dateStr), { year: "numeric", month: "long", day: "numeric" });

  const cancelSubscription = async () => {
    const periodEnd = currentPeriodEnd
      ? formatDate(currentPeriodEnd)
      : tSettings("cancelSub.description");

    if (!confirm(tSettings("cancelSub.confirmPrompt", { periodEnd }))) {
      return;
    }

    setIsCancelling(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}/cancel-subscription`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || tSettings("cancelSub.unableToCancel"));
      }

      const endDate = data.currentPeriodEnd
        ? formatDate(data.currentPeriodEnd)
        : tSettings("cancelSub.description");

      alert(tSettings("cancelSub.cancelledAlert", { endDate }));

      onSubscriptionCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : tSettings("cancelSub.unableToCancel"));
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDeleteOrganization = () => {
    if (!confirm(tSettings("deleteOrg.warningPrompt"))) {
      return;
    }

    setShowDeleteConfirm(true);
  };

  const confirmDeleteOrganization = async () => {
    if (deleteConfirmText !== orgName && deleteConfirmText !== orgSlug) {
      setError(tSettings("deleteOrg.typeError", { orgName, orgSlug }));
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || tSettings("deleteOrg.unableToDelete"));
      }

      alert(tSettings("deleteOrg.deleted"));
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : tSettings("deleteOrg.unableToDelete"));
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteConfirmText("");
    }
  };

  const openBillingPortal = async () => {
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
        throw new Error(data.error || tSettings("billing.unableToOpen"));
      }
      if (data.url) {
        window.location.href = data.url as string;
        return;
      }
      throw new Error(tSettings("billing.noUrl"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tSettings("billing.unableToOpen"));
    } finally {
      setIsOpeningPortal(false);
    }
  };

  return (
    <>
      {/* Billing Management */}
      <Card className="p-6 mt-8 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
          <div>
            <h3 className="font-semibold">{tSettings("billing.title")}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {tSettings("billing.description")}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={openBillingPortal}
            isLoading={isOpeningPortal}
            disabled={!stripeCustomerId}
          >
            {tSettings("billing.manage")}
          </Button>
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="p-6 mt-8 border border-amber-300 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10">
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="text-amber-800 dark:text-amber-200 font-semibold">{tSettings("dangerZone.title")}</h3>
            <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
              {tSettings("dangerZone.description")}
            </p>
          </div>

          {/* Cancel Subscription Section */}
          <div className="border-t border-amber-300 dark:border-amber-700/50 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h4 className="font-medium text-amber-800 dark:text-amber-200">{tSettings("cancelSub.title")}</h4>
                <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                  {tSettings("cancelSub.description")}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={cancelSubscription}
                isLoading={isCancelling}
                disabled={isCancelling || subscriptionStatus === "canceling" || subscriptionStatus === "canceled"}
              >
                {subscriptionStatus === "canceling" ? tSettings("cancelSub.scheduled") : tSettings("cancelSub.button")}
              </Button>
            </div>
            {subscriptionStatus === "canceling" && currentPeriodEnd && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                {tSettings("cancelSub.endsOn", { date: formatDate(currentPeriodEnd) })}
              </p>
            )}
          </div>

          {/* Delete Organization Section */}
          <div className="border-t border-amber-300 dark:border-amber-700/50 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h4 className="font-medium text-amber-800 dark:text-amber-200">{tSettings("deleteOrg.title")}</h4>
                <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                  {tSettings("deleteOrg.description")}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={handleDeleteOrganization}
                isLoading={isDeleting}
                disabled={isDeleting}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600"
              >
                {tSettings("deleteOrg.button")}
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
                {tSettings("deleteOrg.confirmTitle")}
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                {tSettings("deleteOrg.confirmDesc", { orgName })}
              </p>
              <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside">
                <li>{tSettings("deleteOrg.dataMembers")}</li>
                <li>{tSettings("deleteOrg.dataEvents")}</li>
                <li>{tSettings("deleteOrg.dataFiles")}</li>
                <li>{tSettings("deleteOrg.dataBilling")}</li>
              </ul>
            </div>

            <div>
              <label className="text-sm font-medium block mb-2">
                {tSettings("deleteOrg.typeToConfirm", { orgName, orgSlug })}
              </label>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={tSettings("deleteOrg.typePlaceholder", { orgName })}
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
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={confirmDeleteOrganization}
                disabled={isDeleting || (deleteConfirmText !== orgName && deleteConfirmText !== orgSlug)}
                isLoading={isDeleting}
                className="!bg-amber-600 !text-white hover:!bg-amber-700 !border-amber-600"
              >
                {tSettings("deleteOrg.deleteForever")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
