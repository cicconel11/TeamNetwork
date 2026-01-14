"use client";

import { useState } from "react";
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
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cancelSubscription = async () => {
    const periodEnd = currentPeriodEnd
      ? new Date(currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
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

      onSubscriptionCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel subscription");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDeleteOrganization = () => {
    if (!confirm("WARNING: You are about to permanently delete this organization.\n\nAll data including members, alumni, events, records, and files will be lost forever.\n\nThis action CANNOT be undone.\n\nAre you sure you want to continue?")) {
      return;
    }

    setShowDeleteConfirm(true);
  };

  const confirmDeleteOrganization = async () => {
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

  return (
    <>
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
            disabled={!stripeCustomerId}
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
                disabled={isCancelling || subscriptionStatus === "canceling" || subscriptionStatus === "canceled"}
              >
                {subscriptionStatus === "canceling" ? "Cancellation Scheduled" : "Cancel Subscription"}
              </Button>
            </div>
            {subscriptionStatus === "canceling" && currentPeriodEnd && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-2">
                Your subscription will end on {new Date(currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
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
                disabled={isDeleting}
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
    </>
  );
}
