"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Badge, ButtonLink } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { AlumniUsageBar } from "@/components/enterprise/AlumniUsageBar";
import { SeatUsageBar } from "@/components/enterprise/SeatUsageBar";
import { type BillingInterval } from "@/types/enterprise";

const SALES_EMAIL = "sales@myteamnetwork.com";

interface BillingInfo {
  billingInterval: BillingInterval;
  alumniBucketQuantity: number;
  alumniCount: number;
  alumniLimit: number | null;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subOrgCount: number;
  subOrgQuantity: number | null;
}

export function BillingClient({
  enterpriseId,
  enterpriseSlug,
}: {
  enterpriseId: string;
  enterpriseSlug: string;
}) {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

  const loadBilling = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseId}/billing`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load billing information");
      }

      const billingPayload = data?.billing ?? data;
      const usage = billingPayload?.usage ?? {};
      setBilling({
        ...billingPayload,
        alumniBucketQuantity: billingPayload?.alumniBucketQuantity ?? 1,
        alumniCount: usage.alumniCount ?? billingPayload?.alumniCount ?? 0,
        alumniLimit: usage.alumniLimit ?? billingPayload?.alumniLimit ?? null,
        subOrgCount: usage.subOrgCount ?? billingPayload?.subOrgCount ?? 0,
        subOrgQuantity: billingPayload?.subOrgQuantity ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    } finally {
      setIsLoading(false);
    }
  }, [enterpriseId]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const handleOpenPortal = async () => {
    setIsOpeningPortal(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseId}/billing/portal`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to open billing portal");
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      throw new Error("No portal URL returned");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal");
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const getStatusVariant = (
    status: string | undefined
  ): "success" | "warning" | "error" | "muted" => {
    if (!status) return "muted";
    switch (status) {
      case "active":
      case "trialing":
        return "success";
      case "past_due":
        return "warning";
      case "canceled":
        return "error";
      default:
        return "muted";
    }
  };

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Billing" description="Loading..." />
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const hasSubscription = Boolean(billing?.status);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Billing"
        description="Manage your enterprise subscription and quota"
        backHref={`/enterprise/${enterpriseSlug}`}
      />

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Current Plan */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <div>
            <h3 className="font-semibold text-foreground">Current Plan</h3>
            <p className="text-sm text-muted-foreground">Your enterprise subscription details</p>
          </div>
          {billing?.status && (
            <Badge variant={getStatusVariant(billing.status)} className="uppercase tracking-wide">
              {billing.status}
            </Badge>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <div>
            <p className="text-sm text-muted-foreground">Billing Interval</p>
            <p className="text-lg font-semibold text-foreground capitalize">
              {billing?.billingInterval || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Next Billing Date</p>
            <p className="text-lg font-semibold text-foreground">
              {billing?.currentPeriodEnd
                ? new Date(billing.currentPeriodEnd).toLocaleDateString()
                : "N/A"}
            </p>
          </div>
        </div>

        <AlumniUsageBar
          currentCount={billing?.alumniCount ?? 0}
          bucketQuantity={billing?.alumniBucketQuantity ?? 1}
          isSalesManaged
        />

        <div className="mt-6">
          <SeatUsageBar
            currentSeats={billing?.subOrgCount ?? 0}
            billingInterval={billing?.billingInterval ?? "year"}
            bucketQuantity={billing?.alumniBucketQuantity ?? 1}
          />
        </div>
      </Card>

      {/* Contact Sales — enterprise pricing is sales-led */}
      <Card className="p-6 mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <h3 className="font-semibold text-foreground">Enterprise plans are sales-led</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Enterprise pricing is tailored to your organization&apos;s alumni, active members, and
              sub-organizations. To change your plan, add capacity, or get a quote, reach out to our
              team and we&apos;ll get you set up.
            </p>
          </div>
          <ButtonLink href={`mailto:${SALES_EMAIL}`} variant="primary" className="flex-shrink-0">
            Contact Sales
          </ButtonLink>
        </div>
      </Card>

      {/* Billing Portal */}
      {hasSubscription && (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
            <div>
              <h3 className="font-semibold text-foreground">Billing Portal</h3>
              <p className="text-sm text-muted-foreground">
                Manage payment methods, view invoices, and update billing details.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={handleOpenPortal}
              isLoading={isOpeningPortal}
              disabled={isOpeningPortal || !billing?.stripeCustomerId}
            >
              Open Portal
            </Button>
            {!billing?.stripeCustomerId && (
              <p className="text-xs text-muted-foreground mt-2">
                Stripe billing is not yet configured for this enterprise.
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
