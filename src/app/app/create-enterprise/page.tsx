"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Card, Textarea, InlineBanner } from "@/components/ui";
import { useIdempotencyKey } from "@/hooks";
import {
  createEnterpriseV2Schema,
  type CreateEnterpriseV2Form,
} from "@/lib/schemas/organization-v2";
import { quote, isSelfServeSalesLed } from "@/lib/pricing-v2";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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
  } = useForm<CreateEnterpriseV2Form>({
    resolver: zodResolver(createEnterpriseV2Schema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      primaryColor: "#5b21b6",
      billingContactEmail: "",
      actives: 0,
      alumni: 0,
      subOrgs: 1,
      billingInterval: "year",
    },
  });

  const {
    name,
    slug,
    description,
    primaryColor,
    billingContactEmail,
    actives,
    alumni,
    subOrgs,
    billingInterval,
  } = watch();

  const q = useMemo(
    () =>
      quote({
        tier: "enterprise",
        actives: actives || 0,
        alumni: alumni || 0,
        subOrgs: subOrgs || 0,
      }),
    [actives, alumni, subOrgs],
  );
  const salesLed = isSelfServeSalesLed({
    tier: "enterprise",
    actives: actives || 0,
    alumni: alumni || 0,
    subOrgs: subOrgs || 0,
  });
  const displayCents = billingInterval === "year" ? q.yearlyCents : q.monthlyCents;
  const intervalLabel = billingInterval === "year" ? "/yr" : "/mo";

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: name?.trim() || "",
        slug: slug?.trim() || "",
        description: description?.trim() || "",
        primaryColor: primaryColor || "",
        billingContactEmail: billingContactEmail?.trim() || "",
        actives: actives || 0,
        alumni: alumni || 0,
        subOrgs: subOrgs || 0,
        billingInterval,
      }),
    [actives, alumni, billingContactEmail, billingInterval, description, name, primaryColor, slug, subOrgs],
  );
  const { idempotencyKey } = useIdempotencyKey({
    storageKey: "create-enterprise-v2-checkout",
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

  const onSubmit = async (data: CreateEnterpriseV2Form) => {
    setIsLoading(true);
    setError(null);
    if (!idempotencyKey) {
      setError("Preparing checkout... please try again.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/stripe/create-enterprise-v2-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          slug: data.slug,
          description: data.description ?? "",
          primaryColor: data.primaryColor,
          billingInterval: data.billingInterval,
          actives: data.actives,
          alumni: data.alumni,
          subOrgs: data.subOrgs,
          billingContactEmail: data.billingContactEmail,
          idempotencyKey,
        }),
      });

      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.error || "Unable to start checkout");

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

  const submitDisabled = !salesLed && displayCents <= 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app">
            <h1 className="text-2xl font-bold text-foreground">
              Team<span className="text-purple-500">Network</span>
              <span className="ml-2 text-sm font-normal text-muted-foreground">Enterprise</span>
            </h1>
          </Link>
          <form action="/auth/signout" method="POST">
            <Button variant="ghost" size="sm" type="submit">Sign Out</Button>
          </form>
        </div>
      </header>

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
          <div className="lg:col-span-2">
            <Card className="p-8">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-foreground mb-2">Create Enterprise Account</h2>
                <p className="text-muted-foreground">
                  Manage multiple organizations under one roof with shared billing.
                </p>
              </div>

              {error && (
                <InlineBanner variant="error" className="mb-6">{error}</InlineBanner>
              )}

              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="space-y-6">
                  <Input
                    label="Enterprise Name"
                    type="text"
                    placeholder="e.g., Acme Athletics, State University"
                    error={errors.name?.message}
                    {...register("name", { onChange: (e) => handleNameChange(e.target.value) })}
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
                  <Textarea
                    label="Description"
                    placeholder="Tell people about your enterprise..."
                    rows={3}
                    error={errors.description?.message}
                    {...register("description")}
                  />
                  <Input
                    label="Billing Contact Email"
                    type="email"
                    placeholder="billing@example.com"
                    error={errors.billingContactEmail?.message}
                    {...register("billingContactEmail")}
                  />

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Brand Color</label>
                    <div className="flex items-center gap-4">
                      <input
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setValue("primaryColor", e.target.value)}
                        className="h-12 w-20 rounded-xl border border-border cursor-pointer"
                      />
                      <Input
                        type="text"
                        placeholder="#5b21b6"
                        className="flex-1"
                        error={errors.primaryColor?.message}
                        {...register("primaryColor")}
                      />
                    </div>
                  </div>

                  <div className="space-y-3 p-5 rounded-xl border border-border bg-card">
                    <h3 className="text-base font-semibold text-foreground">Billing Frequency</h3>
                    <div className="flex gap-3">
                      {(["month", "year"] as const).map((interval) => (
                        <button
                          key={interval}
                          type="button"
                          onClick={() => setValue("billingInterval", interval)}
                          className={`flex-1 p-3 rounded-lg border ${
                            billingInterval === interval
                              ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                              : "border-border hover:border-muted-foreground"
                          }`}
                        >
                          <p className="font-semibold text-foreground">
                            {interval === "month" ? "Monthly" : "Yearly"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {interval === "month" ? "Billed monthly" : "Save 17%"}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Input
                      label="Active Members"
                      type="number"
                      min={0}
                      error={errors.actives?.message}
                      {...register("actives", { valueAsNumber: true })}
                    />
                    <Input
                      label="Alumni"
                      type="number"
                      min={0}
                      error={errors.alumni?.message}
                      {...register("alumni", { valueAsNumber: true })}
                    />
                    <Input
                      label="Sub-Organizations"
                      type="number"
                      min={0}
                      error={errors.subOrgs?.message}
                      {...register("subOrgs", { valueAsNumber: true })}
                    />
                  </div>

                  {salesLed && (
                    <InlineBanner variant="warning">
                      Your size qualifies for custom enterprise pricing. We&apos;ll reach out to finalize the plan; no payment is collected now.
                    </InlineBanner>
                  )}

                  <div className="flex gap-4 pt-4">
                    <Link href="/app" className="flex-1">
                      <Button type="button" variant="secondary" className="w-full">Cancel</Button>
                    </Link>
                    <Button type="submit" className="flex-1" isLoading={isLoading} disabled={submitDisabled}>
                      {salesLed ? "Contact Sales" : "Continue to Checkout"}
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-8">
              <h3 className="font-semibold text-foreground mb-4">Order Summary</h3>
              <div className="space-y-2 text-sm">
                {salesLed ? (
                  <p className="text-muted-foreground">
                    Custom quote — sales will tailor a plan for your size.
                  </p>
                ) : (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Platform base</span>
                      <span>{formatCents(q.breakdown.platformBaseCents)}/mo</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Active members ({actives || 0})</span>
                      <span>{formatCents(q.breakdown.activeMonthlyCents)}/mo</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Alumni ({alumni || 0})</span>
                      <span>{formatCents(q.breakdown.alumniMonthlyCents)}/mo</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Sub-orgs ({q.breakdown.subOrgsBilled})</span>
                      <span>{formatCents(q.breakdown.subOrgMonthlyCents)}/mo</span>
                    </div>
                    <div className="border-t border-border my-2" />
                    <div className="flex justify-between text-lg">
                      <span className="font-semibold text-foreground">Total</span>
                      <span className="font-bold text-foreground">
                        {formatCents(displayCents)}{intervalLabel}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
