"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";

interface BillingGateProps {
  orgSlug: string;
  organizationId: string;
  status: string;
}

export function BillingGate({ orgSlug, organizationId, status }: BillingGateProps) {
  const [isLoading, setIsLoading] = useState(false);
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

  const statusCopy: Record<string, string> = {
    pending: "Awaiting payment setup to activate your organization.",
    pending_sales: "A team member will reach out to finalize pricing. No payment is due yet.",
    past_due: "Payment issue detected. Please update billing to restore access.",
    canceled: "Subscription canceled. Restart billing to regain access.",
    incomplete: "Subscription is incomplete. Please finish checkout.",
    incomplete_expired: "Checkout expired. Restart billing to continue.",
    trialing: "Trial active. Ensure billing is set up before the trial ends.",
  };

  const friendlyStatus = statusCopy[status] || "Billing required to activate this organization.";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <Card className="max-w-xl w-full p-8 space-y-6 text-center">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">
            Billing Required
          </p>
          <h1 className="text-2xl font-bold text-foreground">Activate your organization</h1>
          <p className="text-muted-foreground">
            The organization at <span className="font-mono text-foreground">/{orgSlug}</span> is not active yet.
            Please complete or update billing to continue.
          </p>
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
            Open Billing Portal
          </Button>
          <Button variant="secondary" onClick={() => (window.location.href = "/app")}>
            Back to Organizations
          </Button>
        </div>
      </Card>
    </div>
  );
}


