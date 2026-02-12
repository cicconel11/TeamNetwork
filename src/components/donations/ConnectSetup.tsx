"use client";

import { useMemo, useState } from "react";
import { Card, CardTitle, CardDescription, Button } from "@/components/ui";
import { useIdempotencyKey } from "@/hooks";
import type { ConnectAccountStatus } from "@/lib/stripe";

interface ConnectSetupProps {
  organizationId: string;
  isConnected: boolean;
  connectStatus?: ConnectAccountStatus | null;
}

function mapConnectError(message: string): string {
  if (message.includes("Forbidden") || message.includes("403")) {
    return "Only organization admins can set up Stripe. Please contact your admin.";
  }
  if (message.includes("read-only") || message.includes("grace period")) {
    return "Your subscription is inactive. Please renew to enable donations.";
  }
  if (message.includes("rate limit") || message.includes("429")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (message.includes("Failed to save")) {
    return "Failed to save the Stripe connection. Please try again.";
  }
  return message;
}

export function ConnectSetup({ organizationId, isConnected, connectStatus }: ConnectSetupProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fingerprint = useMemo(() => organizationId, [organizationId]);
  const { idempotencyKey, refreshKey } = useIdempotencyKey({
    storageKey: `connect-onboarding:${organizationId}`,
    fingerprint,
  });

  const handleSetup = async () => {
    setError(null);
    setIsLoading(true);
    if (!idempotencyKey) {
      setError("Preparing Stripe onboarding... please retry.");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/stripe/connect-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, idempotencyKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to start onboarding");
      }

      if (data.url) {
        refreshKey();
        window.location.href = data.url;
      }
    } catch (err) {
      refreshKey();
      const rawError = err instanceof Error ? err.message : "Something went wrong";
      setError(mapConnectError(rawError));
      setIsLoading(false);
    }
  };

  // Lookup failure -- can't determine status
  if (connectStatus?.lookupFailed) {
    return (
      <Card className="p-6 border-l-4 border-l-amber-500">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <CardTitle>Unable to Check Stripe Status</CardTitle>
            <CardDescription className="mt-1">
              We couldn&apos;t verify your Stripe account status. Please try refreshing the page. If the issue persists, check your{" "}
              <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className="text-org-primary hover:underline">
                Stripe Dashboard
              </a>{" "}
              directly.
            </CardDescription>
          </div>
        </div>
      </Card>
    );
  }

  // Details submitted but charges not yet enabled (under review)
  if (connectStatus?.detailsSubmitted && !connectStatus.chargesEnabled) {
    return (
      <Card className="p-6 border-l-4 border-l-blue-500">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <CardTitle>Stripe Account Under Review</CardTitle>
            <CardDescription className="mt-1">
              Your Stripe account is under review. This usually takes 1-2 business days. You&apos;ll be able to accept donations once verification is complete.
            </CardDescription>
          </div>
        </div>
      </Card>
    );
  }

  // Charges enabled but payouts not yet enabled
  if (connectStatus?.chargesEnabled && !connectStatus.payoutsEnabled) {
    return (
      <Card className="p-6 border-l-4 border-l-emerald-500">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <CardTitle>Donations Enabled</CardTitle>
            <CardDescription className="mt-1">
              Donations are enabled, but payouts to your bank are pending verification.
              Check your{" "}
              <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className="text-org-primary hover:underline">
                Stripe Dashboard
              </a>{" "}
              for payout status.
            </CardDescription>
          </div>
        </div>
      </Card>
    );
  }

  if (isConnected) {
    return (
      <Card className="p-6 border-l-4 border-l-emerald-500">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <CardTitle>Donations Enabled</CardTitle>
            <CardDescription className="mt-1">
              Your organization is connected to Stripe. Donations go directly to your account.
              Manage payouts and view transactions in your{" "}
              <a
                href="https://dashboard.stripe.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-org-primary hover:underline"
              >
                Stripe Dashboard
              </a>
              .
            </CardDescription>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
          <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
        </div>
        <div className="flex-1">
          <CardTitle>Enable Online Donations</CardTitle>
          <CardDescription className="mt-1 mb-4">
            Connect your Stripe account to accept online donations directly. Funds go straight to your
            organization — we don&apos;t take any fees.
          </CardDescription>

          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <span className="font-medium">Before you start:</span>{" "}
              During Stripe setup, you&apos;ll be asked to choose an account type.
              Select <span className="font-semibold">&quot;Individual&quot;</span> unless
              your organization is a registered business entity (LLC, 501(c)(3), etc.).
              Choosing &quot;Business&quot; adds extra verification steps and cannot be easily undone.
            </p>
          </div>

          {error && (
            <p className="text-sm text-error mb-4">{error}</p>
          )}

          <Button onClick={handleSetup} isLoading={isLoading}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Set Up Stripe Account
          </Button>
        </div>
      </div>
    </Card>
  );
}
