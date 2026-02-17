"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, Button, Badge, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { AlumniUsageBar } from "@/components/enterprise/AlumniUsageBar";
import { SeatUsageBar } from "@/components/enterprise/SeatUsageBar";
import { ALUMNI_BUCKET_PRICING, ENTERPRISE_SEAT_PRICING, type BillingInterval } from "@/types/enterprise";
import { isSalesLed } from "@/lib/enterprise/pricing";
import { resolveCurrentQuantity } from "@/lib/enterprise/quota-logic";

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

const BUCKET_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Bucket 1 - Up to 2,500 alumni" },
  { value: 2, label: "Bucket 2 - Up to 5,000 alumni" },
  { value: 3, label: "Bucket 3 - Up to 7,500 alumni" },
  { value: 4, label: "Bucket 4 - Up to 10,000 alumni" },
];

function formatBucketPrice(quantity: number, interval: BillingInterval): string {
  const amount = interval === "month"
    ? (quantity * ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket) / 100
    : (quantity * ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket) / 100;
  return `$${amount.toLocaleString()}/${interval === "month" ? "mo" : "yr"}`;
}

export function BillingClient() {
  const params = useParams();
  const enterpriseSlug = params.enterpriseSlug as string;

  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [selectedBucketQuantity, setSelectedBucketQuantity] = useState(1);
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval>("year");
  const [isUpdatingBucket, setIsUpdatingBucket] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isAddingSeats, setIsAddingSeats] = useState(false);

  const loadBilling = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/billing`);
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
      setSelectedBucketQuantity(billingPayload?.alumniBucketQuantity ?? 1);
      setSelectedInterval(billingPayload?.billingInterval || "year");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    } finally {
      setIsLoading(false);
    }
  }, [enterpriseSlug]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const handleUpgradeBucket = async () => {
    if (!billing) return;

    // Validate: new quantity must be > current
    if (selectedBucketQuantity <= billing.alumniBucketQuantity) {
      setError("Choose a higher bucket quantity to upgrade.");
      return;
    }

    setIsUpdatingBucket(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/billing/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustType: "alumni_bucket",
          newQuantity: selectedBucketQuantity,
          expectedCurrentQuantity: billing.alumniBucketQuantity,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          loadBilling();
        }
        throw new Error(data.error || "Failed to upgrade bucket");
      }

      setSuccessMessage("Alumni bucket upgraded successfully");
      loadBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upgrade bucket");
    } finally {
      setIsUpdatingBucket(false);
    }
  };

  const handleOpenPortal = async () => {
    setIsOpeningPortal(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/billing/portal`, {
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

  const handleAddSeats = async () => {
    setIsAddingSeats(true);
    setError(null);

    try {
      const rawQuantity = billing?.subOrgQuantity;
      const currentQuantity = resolveCurrentQuantity(rawQuantity, billing?.subOrgCount ?? 0);

      const response = await fetch(`/api/enterprise/${enterpriseSlug}/billing/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustType: "sub_org",
          newQuantity: currentQuantity + 1,
          expectedCurrentQuantity: rawQuantity != null ? rawQuantity : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          loadBilling();
        }
        throw new Error(data.error || "Failed to add seats");
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      setSuccessMessage("Seats added successfully");
      loadBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add seats");
    } finally {
      setIsAddingSeats(false);
    }
  };

  const getStatusVariant = (status: string | undefined): "success" | "warning" | "error" | "muted" => {
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

  const isSalesManaged = isSalesLed(billing?.alumniBucketQuantity ?? 0);

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

      {successMessage && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-sm">
          {successMessage}
        </div>
      )}

      {/* Current Plan */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <div>
            <h3 className="font-semibold text-foreground">Current Plan</h3>
            <p className="text-sm text-muted-foreground">
              Your enterprise subscription details
            </p>
          </div>
          {billing?.status && (
            <div className="flex items-center gap-2">
              <Badge variant={getStatusVariant(billing.status)} className="uppercase tracking-wide">
                {billing.status}
              </Badge>
              {isSalesManaged && (
                <Badge variant="muted" className="uppercase tracking-wide">
                  Sales-Managed
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <div>
            <p className="text-sm text-muted-foreground">Alumni Buckets</p>
            {isSalesManaged ? (
              <>
                <p className="text-lg font-semibold text-foreground">Sales-managed</p>
                <p className="text-xs text-muted-foreground">Contact support for adjustments</p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-foreground">
                  {billing?.alumniBucketQuantity ?? 1} bucket{(billing?.alumniBucketQuantity ?? 1) !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {((billing?.alumniBucketQuantity ?? 1) * ALUMNI_BUCKET_PRICING.capacityPerBucket).toLocaleString()} alumni capacity
                </p>
              </>
            )}
          </div>
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
          isSalesManaged={isSalesManaged}
          onUpgrade={!isSalesManaged ? () => {
            const next = (billing?.alumniBucketQuantity ?? 1) + 1;
            if (next <= 4) {
              setSelectedBucketQuantity(next);
            }
          } : undefined}
        />

        <div className="mt-6">
          <SeatUsageBar
            currentSeats={billing?.subOrgCount ?? 0}
            billingInterval={billing?.billingInterval ?? "year"}
            onAddSeats={!isAddingSeats ? handleAddSeats : undefined}
          />
        </div>

        {/* Pricing breakdown */}
        <div className="mt-6 p-4 rounded-xl bg-muted/50">
          <h4 className="text-sm font-medium text-foreground mb-2">Pricing</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            {isSalesManaged ? (
              <li>Alumni: Sales-managed plan (contact support for adjustments)</li>
            ) : (
              <li>
                Alumni: {billing?.alumniBucketQuantity ?? 1} bucket{(billing?.alumniBucketQuantity ?? 1) !== 1 ? "s" : ""} @ {formatBucketPrice(1, billing?.billingInterval ?? "year")} each
              </li>
            )}
            <li>
              <span className="text-green-600 dark:text-green-400">First {ENTERPRISE_SEAT_PRICING.freeSubOrgs} organizations: Free</span>
            </li>
            <li>
              Additional organizations: ${billing?.billingInterval === "month"
                ? (ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly / 100).toFixed(0)
                : (ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly / 100).toFixed(0)
              }/{billing?.billingInterval === "month" ? "mo" : "yr"} each
            </li>
          </ul>
        </div>
      </Card>

      {/* Upgrade Alumni Bucket */}
      <Card className="p-6 mb-6">
        <h3 className="font-semibold text-foreground mb-4">
          {isSalesManaged ? "Alumni Capacity" : "Upgrade Alumni Bucket"}
        </h3>

        {isSalesManaged ? (
          <div className="p-4 rounded-xl bg-muted/50">
            <p className="text-sm text-muted-foreground">
              Your alumni capacity is managed by the sales team. To adjust your plan, please contact support or your account representative.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3 mb-4">
              <div className="sm:col-span-2">
                <Select
                  label="Alumni Bucket Quantity"
                  value={selectedBucketQuantity.toString()}
                  onChange={(e) => setSelectedBucketQuantity(parseInt(e.target.value, 10))}
                  options={BUCKET_OPTIONS.map((option) => ({
                    value: option.value.toString(),
                    label: option.label,
                    disabled: billing
                      ? option.value < billing.alumniBucketQuantity
                      : false,
                  }))}
                />
              </div>
              <div>
                <Select
                  label="Billing Interval"
                  value={selectedInterval}
                  onChange={(e) => setSelectedInterval(e.target.value as BillingInterval)}
                  options={[
                    { value: "month", label: "Monthly" },
                    { value: "year", label: "Yearly (save ~17%)" },
                  ]}
                  disabled
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-muted/50 mb-4">
              <p className="text-sm text-muted-foreground">New alumni price:</p>
              <p className="text-xl font-bold text-foreground">
                {formatBucketPrice(selectedBucketQuantity, selectedInterval)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Alumni capacity: {(selectedBucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket).toLocaleString()}
              </p>
            </div>

            <Button
              onClick={handleUpgradeBucket}
              isLoading={isUpdatingBucket}
              disabled={
                isUpdatingBucket ||
                !billing ||
                selectedBucketQuantity <= billing.alumniBucketQuantity
              }
            >
              Upgrade Bucket
            </Button>
          </>
        )}
      </Card>

      {/* Billing Portal */}
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
            disabled={!billing?.stripeCustomerId}
          >
            Open Portal
          </Button>
        </div>
      </Card>
    </div>
  );
}
