"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";

interface BillingGateProps {
  orgSlug: string;
  organizationId: string;
  status: string;
  gracePeriodExpired?: boolean;
  isAdmin?: boolean;
}

export function BillingGate({ orgSlug, organizationId, status, gracePeriodExpired, isAdmin }: BillingGateProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Unable to open billing portal");
      }
      window.location.href = data.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing portal");
      setIsLoading(false);
    }
  };

  const handleDeleteOrg = async () => {
    if (deleteConfirmText !== orgSlug) return;
    
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to delete organization");
      }
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete organization");
      setIsDeleting(false);
    }
  };

  const statusCopy: Record<string, string> = {
    pending: "Awaiting payment setup to activate your organization.",
    pending_sales: "A team member will reach out to finalize pricing. No payment is due yet.",
    past_due: "Payment issue detected. Please update billing to restore access.",
    canceled: gracePeriodExpired 
      ? "Your grace period has expired. Resubscribe to restore access, or delete this organization." 
      : "Subscription canceled. Resubscribe to continue using this organization.",
    incomplete: "Subscription is incomplete. Please finish checkout.",
    incomplete_expired: "Checkout expired. Restart billing to continue.",
    trialing: "Trial active. Ensure billing is set up before the trial ends.",
  };

  const friendlyStatus = statusCopy[status] || "Billing required to activate this organization.";

  // Different title for grace period expired
  const title = gracePeriodExpired 
    ? "Grace period expired" 
    : "Activate your organization";
  
  const subtitle = gracePeriodExpired
    ? "The 30-day grace period for this organization has ended."
    : `The organization at /${orgSlug} is not active yet. Please complete or update billing to continue.`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <Card className="max-w-xl w-full p-8 space-y-6 text-center">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">
            {gracePeriodExpired ? "Subscription Expired" : "Billing Required"}
          </p>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-muted-foreground">{subtitle}</p>
          <p className="text-sm text-foreground font-medium">
            Status: <span className="uppercase tracking-wide">{status}</span>
          </p>
          <p className="text-sm text-muted-foreground">{friendlyStatus}</p>
          {status === "pending_sales" && (
            <p className="text-amber-600 dark:text-amber-400 text-sm">
              You selected the 1500+ alumni option. Our team will reach out to finalize pricing.
            </p>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={openPortal} isLoading={isLoading}>
            {status === "canceled" ? "Resubscribe" : "Open Billing Portal"}
          </Button>
          <Button variant="secondary" onClick={() => (window.location.href = "/app")}>
            Back to Organizations
          </Button>
        </div>

        {/* Delete option for admins when grace period expired */}
        {gracePeriodExpired && isAdmin && (
          <div className="pt-4 border-t border-border">
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-sm text-muted-foreground hover:text-red-500 transition-colors"
              >
                Or permanently delete this organization
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Type <span className="font-mono font-bold text-foreground">{orgSlug}</span> to confirm deletion:
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={orgSlug}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm"
                />
                <div className="flex gap-2 justify-center">
                  <Button
                    variant="danger"
                    onClick={handleDeleteOrg}
                    isLoading={isDeleting}
                    disabled={deleteConfirmText !== orgSlug}
                  >
                    Delete Forever
                  </Button>
                  <Button variant="secondary" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
