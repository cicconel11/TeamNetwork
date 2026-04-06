"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Card, Textarea, Select, InlineBanner, ToggleSwitch } from "@/components/ui";
import { FeedbackButton } from "@/components/feedback";
import { useIdempotencyKey } from "@/hooks";
import { createOrgSchema, type CreateOrgForm } from "@/lib/schemas/organization";
import { ORG_TRIAL_DAYS, isOrgFreeTrialSelectable } from "@/lib/subscription/org-trial";
import {
  BASE_PRICES,
  ALUMNI_ADD_ON_PRICES,
  ALUMNI_BUCKET_LABELS,
  getTotalPrice,
  formatPrice,
} from "@/lib/pricing";
import type { AlumniBucket } from "@/types/database";

const ALUMNI_OPTIONS = (Object.entries(ALUMNI_BUCKET_LABELS) as [AlumniBucket, string][]).map(
  ([value, label]) => ({ value, label }),
);

export default function CreateOrgPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<CreateOrgForm>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      primaryColor: "#1e3a5f",
      billingInterval: "month",
      alumniBucket: "none",
      withTrial: false,
    },
  });

  const formValues = watch();
  const { name, slug, primaryColor, billingInterval, alumniBucket, withTrial } = formValues;
  const trialEligible = isOrgFreeTrialSelectable({ billingInterval, alumniBucket });
  const effectiveWithTrial = trialEligible && Boolean(withTrial);

  useEffect(() => {
    if (!trialEligible && withTrial) {
      setValue("withTrial", false);
    }
  }, [setValue, trialEligible, withTrial]);

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: name?.trim() || "",
        slug: slug?.trim() || "",
        description: formValues.description?.trim() || "",
        primaryColor: primaryColor || "",
        billingInterval,
        alumniBucket,
        withTrial: effectiveWithTrial,
      }),
    [alumniBucket, billingInterval, formValues.description, effectiveWithTrial, name, primaryColor, slug],
  );
  const { idempotencyKey } = useIdempotencyKey({
    storageKey: "create-org-checkout",
    fingerprint,
  });

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setValue("name", value);
    // Generate slug: lowercase, replace spaces with hyphens, remove special chars
    const generatedSlug = value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    setValue("slug", generatedSlug);
  };

  const handleNext = async () => {
    const valid = await trigger(["name", "slug"]);
    if (valid) {
      setStep(2);
    }
  };

  const onSubmit = async (data: CreateOrgForm) => {
    setIsLoading(true);
    setError(null);
    setInfoMessage(null);
    if (!idempotencyKey) {
      setError("Preparing checkout... please try again.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/stripe/create-org-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          slug: data.slug,
          description: data.description,
          primaryColor: data.primaryColor,
          billingInterval: data.billingInterval,
          alumniBucket: data.alumniBucket,
          withTrial: effectiveWithTrial,
          idempotencyKey,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || "Unable to start checkout");
      }

      if (responseData.mode === "sales") {
        setInfoMessage("Thank you! We will contact you to finalize a custom alumni plan.");
        router.push(`/app?org=${data.slug}&billing=pending-sales`);
        return;
      }

      if (responseData.url) {
        window.location.href = responseData.url as string;
        return;
      }

      throw new Error("Missing checkout URL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  // Dynamic pricing summary
  const basePrice = BASE_PRICES[billingInterval];
  const alumniAddon =
    alumniBucket !== "none" && alumniBucket !== "5000+"
      ? ALUMNI_ADD_ON_PRICES[alumniBucket][billingInterval]
      : null;
  const totalPrice = getTotalPrice(billingInterval, alumniBucket);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app">
            <h1 className="flex items-center gap-2.5">
              <Image src="/TeamNetwor.png" alt="" width={541} height={303}
                     className="h-7 w-auto object-contain" aria-hidden="true" />
              <span className="text-2xl font-bold text-foreground">
                <span className="text-green-500">Team</span>Network
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
      <main className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <Link href="/app" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Organizations
          </Link>
        </div>

        <Card className="p-8">
          <div className="mb-8">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              Step {step} of 2
            </p>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {step === 1 ? "Your Organization" : "Plan & Billing"}
            </h2>
            <p className="text-muted-foreground">
              {step === 1
                ? "Set up your team, club, or group. You\u2019ll be the admin and can invite members later."
                : "Choose your billing plan and alumni access level."}
            </p>
          </div>

          {error && (
            <InlineBanner variant="error" className="mb-6">
              {error}
              <div className="mt-2 flex justify-end">
                <FeedbackButton context="create-org" trigger="checkout_error" />
              </div>
            </InlineBanner>
          )}
          {infoMessage && (
            <InlineBanner variant="success" className="mb-6">
              {infoMessage}
            </InlineBanner>
          )}

          <form onSubmit={handleSubmit(onSubmit)}>
            <input type="hidden" {...register("withTrial")} />

            {/* Step 1: Your Organization */}
            {step === 1 && (
              <div className="space-y-6">
                <Input
                  label="Organization Name"
                  type="text"
                  placeholder="e.g., Stanford Crew, The Whiffenpoofs"
                  error={errors.name?.message}
                  {...register("name", {
                    onChange: (e) => handleNameChange(e.target.value),
                  })}
                />

                <Input
                  label="URL Slug"
                  type="text"
                  placeholder="my-organization"
                  helperText={`Your organization will be at: teamnetwork.app/${slug || "your-slug"}`}
                  error={errors.slug?.message}
                  {...register("slug", {
                    onChange: (e) => {
                      e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                    },
                  })}
                />

                <Textarea
                  label="Description"
                  placeholder="Tell people about your organization..."
                  rows={3}
                  error={errors.description?.message}
                  {...register("description")}
                />

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Brand Color
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setValue("primaryColor", e.target.value)}
                      className="h-12 w-20 rounded-xl border border-border cursor-pointer"
                    />
                    <Input
                      type="text"
                      placeholder="#1e3a5f"
                      className="flex-1"
                      error={errors.primaryColor?.message}
                      {...register("primaryColor")}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This color will be used for your organization&apos;s branding
                  </p>
                </div>

                <div className="flex gap-4 pt-4">
                  <Link href="/app" className="flex-1">
                    <Button type="button" variant="secondary" className="w-full">
                      Cancel
                    </Button>
                  </Link>
                  <Button type="button" className="flex-1" onClick={handleNext}>
                    Next
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Plan & Billing */}
            {step === 2 && (
              <div className="space-y-6">
                {/* Billing Interval */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Billing Interval</p>
                  <div className="flex gap-2">
                    {(["month", "year"] as const).map((interval) => (
                      <button
                        key={interval}
                        type="button"
                        onClick={() => setValue("billingInterval", interval)}
                        className={`flex-1 px-4 py-3 rounded-xl border ${
                          billingInterval === interval
                            ? "border-org-primary bg-org-primary text-org-primary-foreground"
                            : "border-border bg-muted text-foreground"
                        }`}
                      >
                        {interval === "month" ? "Monthly" : "Yearly (save 2 months)"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Alumni Access */}
                <Select
                  label="Alumni Access"
                  options={ALUMNI_OPTIONS}
                  error={errors.alumniBucket?.message}
                  {...register("alumniBucket")}
                />

                {/* Dynamic Pricing Summary */}
                <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm space-y-2">
                  <p className="font-semibold text-foreground">Pricing Summary</p>
                  {totalPrice !== null ? (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Active Team</span>
                        <span>{formatPrice(basePrice, billingInterval)}</span>
                      </div>
                      {alumniAddon !== null && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Alumni ({ALUMNI_BUCKET_LABELS[alumniBucket]})</span>
                          <span>+{formatPrice(alumniAddon, billingInterval)}</span>
                        </div>
                      )}
                      <div className="border-t border-border my-1" />
                      <div className="flex justify-between font-medium text-foreground">
                        <span>Total</span>
                        <span>{formatPrice(totalPrice, billingInterval)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Custom quote &mdash; we&apos;ll reach out to discuss pricing for your alumni network.
                    </p>
                  )}
                </div>

                {/* 5000+ warning */}
                {alumniBucket === "5000+" && (
                  <InlineBanner variant="warning">
                    For 5,000+ alumni, we will contact you with custom pricing. No payment is collected now and the org will remain pending_sales.
                  </InlineBanner>
                )}

                {/* Trial toggle */}
                {trialEligible && (
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1 pr-4">
                        <p className="font-medium text-foreground">
                          {ORG_TRIAL_DAYS}-day free trial
                        </p>
                        <p className="text-muted-foreground">
                          Your card is collected now. Billing starts when the trial ends unless you cancel.
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={effectiveWithTrial}
                        onChange={(checked) => setValue("withTrial", checked)}
                        label={`Enable ${ORG_TRIAL_DAYS}-day free trial`}
                      />
                    </div>
                    {effectiveWithTrial && (
                      <p className="text-emerald-600 dark:text-emerald-400">
                        Trial selected. Your organization will be active immediately, and the first charge will happen after {ORG_TRIAL_DAYS} days.
                      </p>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" isLoading={isLoading}>
                    {effectiveWithTrial ? `Start ${ORG_TRIAL_DAYS}-Day Free Trial` : "Create Organization"}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Card>
      </main>
    </div>
  );
}
