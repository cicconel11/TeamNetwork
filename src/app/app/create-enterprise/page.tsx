"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Card } from "@/components/ui";
import { useIdempotencyKey } from "@/hooks";
import {
  ENTERPRISE_SEAT_PRICING,
  ALUMNI_BUCKET_PRICING,
} from "@/types/enterprise";
import { isSalesLed } from "@/lib/enterprise/pricing";

const MIN_SEATS = 1;
const MAX_SEATS = 100;

const createEnterpriseSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(50, "Slug must be less than 50 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens",
    ),
  billingContactEmail: z.string().email("Invalid email address"),
  seatQuantity: z.number().min(MIN_SEATS).max(MAX_SEATS),
  alumniBucketQuantity: z.number().min(1).max(5),
  billingInterval: z.enum(["month", "year"]),
});

type CreateEnterpriseForm = z.infer<typeof createEnterpriseSchema>;

const ALUMNI_BUCKET_OPTIONS = [
  {
    buckets: 1,
    capacity: ALUMNI_BUCKET_PRICING.capacityPerBucket,
    monthlyPrice: ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket / 100,
    yearlyPrice: ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket / 100,
    description: "0 - 2,500 alumni",
  },
  {
    buckets: 2,
    capacity: ALUMNI_BUCKET_PRICING.capacityPerBucket * 2,
    monthlyPrice: (ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket * 2) / 100,
    yearlyPrice: (ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket * 2) / 100,
    description: "2,501 - 5,000 alumni",
  },
  {
    buckets: 3,
    capacity: ALUMNI_BUCKET_PRICING.capacityPerBucket * 3,
    monthlyPrice: (ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket * 3) / 100,
    yearlyPrice: (ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket * 3) / 100,
    description: "5,001 - 7,500 alumni",
  },
  {
    buckets: 4,
    capacity: ALUMNI_BUCKET_PRICING.capacityPerBucket * 4,
    monthlyPrice: (ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket * 4) / 100,
    yearlyPrice: (ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket * 4) / 100,
    description: "7,501 - 10,000 alumni",
  },
  {
    buckets: 5,
    capacity: null,
    monthlyPrice: null,
    yearlyPrice: null,
    description: "10,000+ alumni (Contact Sales)",
  },
] as const;

function calculateSeatPrice(
  quantity: number,
): { totalCentsYearly: number; billableOrgs: number; freeOrgs: number } {
  const freeOrgs = Math.min(quantity, ENTERPRISE_SEAT_PRICING.freeSubOrgs);
  const billableOrgs = Math.max(0, quantity - ENTERPRISE_SEAT_PRICING.freeSubOrgs);
  const totalCentsYearly = billableOrgs * ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;

  return { totalCentsYearly, billableOrgs, freeOrgs };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString()}`;
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
      seatQuantity: 3, // Default to free tier
      alumniBucketQuantity: 1,
      billingInterval: "year",
    },
  });

  const { name, slug, billingContactEmail, seatQuantity, alumniBucketQuantity, billingInterval } = watch();

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: name?.trim() || "",
        slug: slug?.trim() || "",
        billingContactEmail: billingContactEmail?.trim() || "",
        seatQuantity,
        alumniBucketQuantity,
        billingInterval,
      }),
    [name, slug, billingContactEmail, seatQuantity, alumniBucketQuantity, billingInterval],
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
          billingInterval: data.billingInterval,
          alumniBucketQuantity: data.alumniBucketQuantity,
          subOrgQuantity: data.seatQuantity,
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

      if (responseData.pending) {
        router.push(`/app?enterprise=${data.slug}&billing=pending`);
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

  const handleSeatChange = (delta: number) => {
    const newValue = Math.max(
      MIN_SEATS,
      Math.min(MAX_SEATS, seatQuantity + delta),
    );
    setValue("seatQuantity", newValue);
  };

  const seatPricing = calculateSeatPrice(seatQuantity);
  const selectedBucket = ALUMNI_BUCKET_OPTIONS.find((opt) => opt.buckets === alumniBucketQuantity);
  const isContactSales = isSalesLed(alumniBucketQuantity);

  const alumniMonthlyPrice = selectedBucket?.monthlyPrice ?? 0;
  const alumniYearlyPrice = selectedBucket?.yearlyPrice ?? 0;

  const seatMonthlyPrice = seatPricing.billableOrgs * (ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly / 100);
  const seatYearlyPrice = seatPricing.totalCentsYearly / 100;

  const totalMonthly = alumniMonthlyPrice + seatMonthlyPrice;
  const totalYearly = alumniYearlyPrice + seatYearlyPrice;

  const displayTotal = billingInterval === "month" ? totalMonthly : totalYearly;
  const displayInterval = billingInterval === "month" ? "/mo" : "/yr";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app">
            <h1 className="text-2xl font-bold text-foreground">
              Team<span className="text-purple-500">Network</span>
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                Enterprise
              </span>
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
          <Link
            href="/app"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="lg:col-span-2">
            <Card className="p-8">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  Create Enterprise Account
                </h2>
                <p className="text-muted-foreground">
                  Manage multiple organizations under one roof with pooled
                  alumni quotas and unified billing.
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
                        e.target.value = e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, "");
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

                  {/* Billing Interval Toggle */}
                  <div className="space-y-3 p-5 rounded-xl border border-border bg-card">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        Billing Frequency
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Choose monthly or yearly billing
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setValue("billingInterval", "month")}
                        className={`flex-1 p-3 rounded-lg border transition-all ${
                          billingInterval === "month"
                            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                            : "border-border hover:border-muted-foreground"
                        }`}
                      >
                        <p className="font-semibold text-foreground">Monthly</p>
                        <p className="text-xs text-muted-foreground">Billed monthly</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setValue("billingInterval", "year")}
                        className={`flex-1 p-3 rounded-lg border transition-all ${
                          billingInterval === "year"
                            ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                            : "border-border hover:border-muted-foreground"
                        }`}
                      >
                        <p className="font-semibold text-foreground">Yearly</p>
                        <p className="text-xs text-muted-foreground">Save 17%</p>
                      </button>
                    </div>
                  </div>

                  {/* Section 1: Enterprise-Managed Org Seats */}
                  <div className="space-y-4 p-5 rounded-xl border border-border bg-card">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        Enterprise-Managed Organizations
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        How many organizations do you need to manage?
                      </p>
                    </div>

                    {/* Free tier callout */}
                    <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                      <p className="text-sm text-green-800 dark:text-green-200">
                        <span className="font-semibold">First {ENTERPRISE_SEAT_PRICING.freeSubOrgs} organizations are FREE!</span>
                        <span className="block mt-1 text-green-700 dark:text-green-300">
                          ${(ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly / 100).toFixed(0)}/year for each additional organization
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center border border-border rounded-xl">
                        <button
                          type="button"
                          onClick={() => handleSeatChange(-1)}
                          disabled={seatQuantity <= MIN_SEATS}
                          className="px-4 py-3 text-lg font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed rounded-l-xl"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={MIN_SEATS}
                          max={MAX_SEATS}
                          value={seatQuantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (
                              !isNaN(val) &&
                              val >= MIN_SEATS &&
                              val <= MAX_SEATS
                            ) {
                              setValue("seatQuantity", val);
                            }
                          }}
                          className="w-16 text-center py-3 text-lg font-semibold bg-transparent border-x border-border focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleSeatChange(1)}
                          disabled={seatQuantity >= MAX_SEATS}
                          className="px-4 py-3 text-lg font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed rounded-r-xl"
                        >
                          +
                        </button>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {seatQuantity <= ENTERPRISE_SEAT_PRICING.freeSubOrgs ? (
                          <span className="text-green-600 dark:text-green-400 font-medium">
                            Free!
                          </span>
                        ) : (
                          <span>
                            {seatQuantity - ENTERPRISE_SEAT_PRICING.freeSubOrgs} paid @ {formatCents(ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly)}/yr each
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Alumni Bucket Selector */}
                  <div className="space-y-4 p-5 rounded-xl border border-border bg-card">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        Alumni Bucket Size
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Each bucket provides 2,500 alumni capacity (minimum 1 bucket required)
                      </p>
                    </div>

                    <div className="grid gap-3">
                      {ALUMNI_BUCKET_OPTIONS.map((option) => {
                        const isSelected = alumniBucketQuantity === option.buckets;
                        const isContactSales = option.buckets === 5;

                        return (
                          <button
                            key={option.buckets}
                            type="button"
                            onClick={() => setValue("alumniBucketQuantity", option.buckets)}
                            className={`text-left p-4 rounded-xl border transition-all ${
                              isSelected
                                ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                                : "border-border hover:border-muted-foreground"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-semibold text-foreground">
                                  Bucket {option.buckets}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {option.description}
                                </p>
                              </div>
                              <div className="text-right">
                                {isContactSales ? (
                                  <p className="text-sm font-medium text-purple-600 dark:text-purple-400">
                                    Contact Sales
                                  </p>
                                ) : (
                                  <>
                                    <p className="font-medium text-foreground">
                                      ${billingInterval === "month" ? option.monthlyPrice : option.yearlyPrice}{displayInterval}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {option.capacity?.toLocaleString()} alumni
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Link href="/app" className="flex-1">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                      >
                        Cancel
                      </Button>
                    </Link>
                    {isContactSales ? (
                      <Button
                        type="submit"
                        className="flex-1"
                        isLoading={isLoading}
                      >
                        Contact Sales
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        className="flex-1"
                        isLoading={isLoading}
                      >
                        Continue to Checkout
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </Card>
          </div>

          {/* Pricing Summary */}
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-8">
              <h3 className="font-semibold text-foreground mb-4">
                Order Summary
              </h3>

              <div className="space-y-3 text-sm">
                {/* Alumni buckets */}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Alumni buckets</span>
                  <span className="text-foreground font-medium">
                    {isContactSales
                      ? "Contact Sales"
                      : `${alumniBucketQuantity} × $${billingInterval === "month" ? (ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket / 100) : (ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket / 100)}${displayInterval}`}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground pl-4">Capacity</span>
                  <span className="text-muted-foreground">
                    {isContactSales
                      ? "Custom"
                      : `${(alumniBucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket).toLocaleString()} alumni`}
                  </span>
                </div>

                <div className="border-t border-border my-2"></div>

                {/* Organizations */}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Organizations</span>
                  <span className="text-foreground font-medium">
                    {seatQuantity}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground pl-4">Free</span>
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {seatPricing.freeOrgs}
                  </span>
                </div>
                {seatPricing.billableOrgs > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground pl-4">Paid</span>
                    <span className="text-foreground font-medium">
                      {seatPricing.billableOrgs} × ${billingInterval === "month" ? (ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly / 100) : (ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly / 100)}{displayInterval}
                    </span>
                  </div>
                )}

                <div className="border-t border-border pt-3 mt-3">
                  <div className="flex justify-between text-lg">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-bold text-foreground">
                      {isContactSales ? "Contact Sales" : `$${displayTotal.toFixed(2)}${displayInterval}`}
                    </span>
                  </div>
                  {!isContactSales && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Alumni buckets: ${billingInterval === "month" ? alumniMonthlyPrice : alumniYearlyPrice}
                      {seatPricing.billableOrgs > 0 && ` + Organizations: $${billingInterval === "month" ? seatMonthlyPrice : seatYearlyPrice}`}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 p-3 rounded-lg bg-muted/50 text-sm">
                <p className="text-muted-foreground">
                  {isContactSales ? (
                    "Custom alumni quota — our sales team will tailor a plan for your needs"
                  ) : (
                    <>
                      Pooled alumni quota of{" "}
                      <span className="font-medium text-foreground">
                        {(alumniBucketQuantity * ALUMNI_BUCKET_PRICING.capacityPerBucket).toLocaleString()}
                      </span>{" "}
                      alumni across all enterprise-managed organizations
                    </>
                  )}
                </p>
              </div>

              <div className="mt-6 p-4 rounded-xl bg-purple-50 dark:bg-purple-900/20">
                <h4 className="font-medium text-purple-800 dark:text-purple-200 mb-2">
                  Enterprise Benefits
                </h4>
                <ul className="text-xs text-purple-700 dark:text-purple-300 space-y-1">
                  <li>First {ENTERPRISE_SEAT_PRICING.freeSubOrgs} organizations free</li>
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
