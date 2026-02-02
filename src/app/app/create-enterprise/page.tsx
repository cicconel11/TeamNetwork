"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Card, Select } from "@/components/ui";
import { useIdempotencyKey } from "@/hooks";
import {
  ENTERPRISE_TIER_LIMITS,
  ENTERPRISE_TIER_PRICING,
  type EnterpriseTier,
  type BillingInterval,
} from "@/types/enterprise";

const createEnterpriseSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(50, "Slug must be less than 50 characters")
    .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
  billingContactEmail: z.string().email("Invalid email address"),
  tier: z.enum(["tier_1", "tier_2", "tier_3"]),
  billingInterval: z.enum(["month", "year"]),
});

type CreateEnterpriseForm = z.infer<typeof createEnterpriseSchema>;

const TIER_INFO: Record<EnterpriseTier, { name: string; description: string }> = {
  tier_1: {
    name: "Starter",
    description: "Up to 5,000 pooled alumni across all organizations",
  },
  tier_2: {
    name: "Growth",
    description: "Up to 10,000 pooled alumni across all organizations",
  },
  tier_3: {
    name: "Enterprise",
    description: "Unlimited alumni with custom pricing",
  },
  custom: {
    name: "Custom",
    description: "Custom plan",
  },
};

function formatPrice(tier: EnterpriseTier, interval: BillingInterval): string {
  const pricing = ENTERPRISE_TIER_PRICING[tier];
  if (!pricing) return "Contact us";
  const amount = interval === "month" ? pricing.monthly : pricing.yearly;
  return `$${(amount / 100).toLocaleString()}`;
}

function formatPriceInterval(interval: BillingInterval): string {
  return interval === "month" ? "/mo" : "/yr";
}

export default function CreateEnterprisePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateEnterpriseForm>({
    resolver: zodResolver(createEnterpriseSchema),
    defaultValues: {
      name: "",
      slug: "",
      billingContactEmail: "",
      tier: "tier_1",
      billingInterval: "month",
    },
  });

  const { name, slug, tier, billingInterval } = watch();

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: name?.trim() || "",
        slug: slug?.trim() || "",
        tier,
        billingInterval,
      }),
    [name, slug, tier, billingInterval]
  );

  const { idempotencyKey } = useIdempotencyKey({
    storageKey: "create-enterprise-checkout",
    fingerprint,
  });

  const handleNameChange = (value: string) => {
    setValue("name", value);
    const generatedSlug = value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    setValue("slug", generatedSlug);
  };

  const onSubmit = async (data: CreateEnterpriseForm) => {
    setIsLoading(true);
    setError(null);

    if (!idempotencyKey) {
      setError("Preparing checkout... please try again.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/stripe/create-enterprise-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          slug: data.slug,
          billingContactEmail: data.billingContactEmail,
          tier: data.tier,
          billingInterval: data.billingInterval,
          idempotencyKey,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || "Unable to start checkout");
      }

      if (responseData.mode === "sales") {
        router.push(`/app?enterprise=${data.slug}&billing=pending-sales`);
        return;
      }

      const checkoutUrl = responseData.checkoutUrl ?? responseData.url;
      if (checkoutUrl) {
        window.location.href = checkoutUrl as string;
        return;
      }

      throw new Error("Missing checkout URL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  const selectedTierPricing = ENTERPRISE_TIER_PRICING[tier as EnterpriseTier];
  const selectedTierLimit = ENTERPRISE_TIER_LIMITS[tier as EnterpriseTier];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app">
            <h1 className="text-2xl font-bold text-foreground">
              Team<span className="text-purple-500">Network</span>
              <span className="ml-2 text-sm font-normal text-muted-foreground">Enterprise</span>
            </h1>
          </Link>
          <form action="/auth/signout" method="POST">
            <Button variant="ghost" size="sm" type="submit">
              Sign Out
            </Button>
          </form>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <Link href="/app" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="lg:col-span-2">
            <Card className="p-8">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-foreground mb-2">Create Enterprise Account</h2>
                <p className="text-muted-foreground">
                  Manage multiple organizations under one roof with pooled alumni quotas and unified billing.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="space-y-6">
                  <Input
                    label="Enterprise Name"
                    type="text"
                    placeholder="e.g., Acme Athletics, State University"
                    error={errors.name?.message}
                    {...register("name", {
                      onChange: (e) => handleNameChange(e.target.value),
                    })}
                  />

                  <Input
                    label="URL Slug"
                    type="text"
                    placeholder="acme-athletics"
                    helperText={`Your enterprise will be at: teamnetwork.app/enterprise/${slug || "your-slug"}`}
                    error={errors.slug?.message}
                    {...register("slug", {
                      onChange: (e) => {
                        e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                      },
                    })}
                  />

                  <Input
                    label="Billing Contact Email"
                    type="email"
                    placeholder="billing@example.com"
                    error={errors.billingContactEmail?.message}
                    {...register("billingContactEmail")}
                  />

                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-foreground">
                      Select Your Tier
                    </label>
                    <div className="grid gap-3">
                      {(["tier_1", "tier_2", "tier_3"] as const).map((t) => {
                        const info = TIER_INFO[t];
                        const pricing = ENTERPRISE_TIER_PRICING[t];
                        const limit = ENTERPRISE_TIER_LIMITS[t];
                        const isSelected = tier === t;

                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setValue("tier", t)}
                            className={`text-left p-4 rounded-xl border transition-all ${
                              isSelected
                                ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                                : "border-border hover:border-muted-foreground"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-semibold text-foreground">{info.name}</p>
                                <p className="text-sm text-muted-foreground">{info.description}</p>
                              </div>
                              <div className="text-right">
                                {pricing ? (
                                  <>
                                    <p className="font-bold text-foreground">
                                      {formatPrice(t, billingInterval)}
                                      <span className="text-sm font-normal text-muted-foreground">
                                        {formatPriceInterval(billingInterval)}
                                      </span>
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Up to {limit?.toLocaleString()} alumni
                                    </p>
                                  </>
                                ) : (
                                  <p className="font-semibold text-purple-600 dark:text-purple-400">
                                    Contact us
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                      Billing Interval
                    </label>
                    <div className="flex gap-2">
                      {(["month", "year"] as const).map((interval) => (
                        <button
                          key={interval}
                          type="button"
                          onClick={() => setValue("billingInterval", interval)}
                          className={`flex-1 px-4 py-3 rounded-xl border ${
                            billingInterval === interval
                              ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:border-muted-foreground"
                          }`}
                        >
                          {interval === "month" ? "Monthly" : "Yearly (save ~17%)"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Link href="/app" className="flex-1">
                      <Button type="button" variant="secondary" className="w-full">
                        Cancel
                      </Button>
                    </Link>
                    <Button type="submit" className="flex-1" isLoading={isLoading}>
                      {tier === "tier_3" ? "Contact Sales" : "Continue to Checkout"}
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          </div>

          {/* Pricing Summary */}
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-8">
              <h3 className="font-semibold text-foreground mb-4">Order Summary</h3>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tier</span>
                  <span className="text-foreground font-medium">
                    {TIER_INFO[tier as EnterpriseTier]?.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Alumni Limit</span>
                  <span className="text-foreground font-medium">
                    {selectedTierLimit?.toLocaleString() ?? "Unlimited"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Billing</span>
                  <span className="text-foreground font-medium capitalize">{billingInterval}ly</span>
                </div>

                <div className="border-t border-border pt-3 mt-3">
                  <div className="flex justify-between text-lg">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-bold text-foreground">
                      {selectedTierPricing
                        ? `${formatPrice(tier as EnterpriseTier, billingInterval)}${formatPriceInterval(billingInterval)}`
                        : "Contact us"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 rounded-xl bg-purple-50 dark:bg-purple-900/20">
                <h4 className="font-medium text-purple-800 dark:text-purple-200 mb-2">
                  Enterprise Benefits
                </h4>
                <ul className="text-xs text-purple-700 dark:text-purple-300 space-y-1">
                  <li>Pooled alumni quota across organizations</li>
                  <li>Unified billing for all sub-orgs</li>
                  <li>Centralized admin dashboard</li>
                  <li>Adopt existing organizations</li>
                  <li>Priority support</li>
                </ul>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
