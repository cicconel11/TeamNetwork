"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, Button, Badge, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { AlumniUsageBar } from "@/components/enterprise/AlumniUsageBar";
import { ENTERPRISE_TIER_LIMITS, ENTERPRISE_TIER_PRICING, type EnterpriseTier, type BillingInterval } from "@/types/enterprise";

interface BillingInfo {
  tier: EnterpriseTier;
  billingInterval: BillingInterval;
  alumniLimit: number | null;
  alumniCount: number;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

const TIER_OPTIONS: { value: EnterpriseTier; label: string }[] = [
  { value: "tier_1", label: "Tier 1 - Up to 5,000 alumni" },
  { value: "tier_2", label: "Tier 2 - Up to 10,000 alumni" },
  { value: "tier_3", label: "Tier 3 - Unlimited (Custom)" },
];

function formatPrice(tier: EnterpriseTier, interval: BillingInterval): string {
  const pricing = ENTERPRISE_TIER_PRICING[tier];
  if (!pricing) return "Contact for pricing";
  const amount = interval === "month" ? pricing.monthly : pricing.yearly;
  return `$${(amount / 100).toLocaleString()}/${interval === "month" ? "mo" : "yr"}`;
}

export default function BillingPage() {
  const params = useParams();
  const enterpriseSlug = params.enterpriseSlug as string;

  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [selectedTier, setSelectedTier] = useState<EnterpriseTier>("tier_1");
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval>("month");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);

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
        alumniCount: usage.alumniCount ?? billingPayload?.alumniCount ?? 0,
        alumniLimit: usage.alumniLimit ?? billingPayload?.alumniLimit ?? null,
      });
      setSelectedTier(billingPayload?.tier || "tier_1");
      setSelectedInterval(billingPayload?.billingInterval || "month");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    } finally {
      setIsLoading(false);
    }
  }, [enterpriseSlug]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const handleUpdatePlan = async () => {
    const targetLimit = ENTERPRISE_TIER_LIMITS[selectedTier];
    if (billing && targetLimit !== null && billing.alumniCount > targetLimit) {
      setError("Your current alumni count exceeds this tier's limit. Choose a larger tier.");
      return;
    }

    setIsUpdating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: selectedTier,
          interval: selectedInterval,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update plan");
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      setSuccessMessage("Plan updated successfully");
      loadBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan");
    } finally {
      setIsUpdating(false);
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
            <Badge variant={getStatusVariant(billing.status)} className="uppercase tracking-wide">
              {billing.status}
            </Badge>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <div>
            <p className="text-sm text-muted-foreground">Tier</p>
            <p className="text-lg font-semibold text-foreground capitalize">
              {billing?.tier?.replace("_", " ") || "None"}
            </p>
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
          limit={billing?.alumniLimit ?? null}
        />
      </Card>

      {/* Change Plan */}
      <Card className="p-6 mb-6">
        <h3 className="font-semibold text-foreground mb-4">Change Plan</h3>

        <div className="grid gap-4 sm:grid-cols-3 mb-4">
          <div className="sm:col-span-2">
            <Select
              label="Enterprise Tier"
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value as EnterpriseTier)}
              options={TIER_OPTIONS.map((option) => ({
                ...option,
                disabled:
                  billing
                    ? ENTERPRISE_TIER_LIMITS[option.value] !== null &&
                      billing.alumniCount > ENTERPRISE_TIER_LIMITS[option.value]!
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
            />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-muted/50 mb-4">
          <p className="text-sm text-muted-foreground">New price:</p>
          <p className="text-xl font-bold text-foreground">
            {formatPrice(selectedTier, selectedInterval)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Alumni limit: {ENTERPRISE_TIER_LIMITS[selectedTier]?.toLocaleString() ?? "Unlimited"}
          </p>
        </div>

        <Button
          onClick={handleUpdatePlan}
          isLoading={isUpdating}
          disabled={
            isUpdating ||
            (billing?.tier === selectedTier &&
              billing?.billingInterval === selectedInterval &&
              !!billing?.stripeSubscriptionId)
          }
        >
          {billing?.stripeSubscriptionId ? "Update Plan" : "Subscribe"}
        </Button>
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
