"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Card, Textarea, InlineBanner } from "@/components/ui";
import { FeedbackButton } from "@/components/feedback";
import { useIdempotencyKey } from "@/hooks";
import { createOrgV2Schema, type CreateOrgV2Form } from "@/lib/schemas/organization-v2";
import { quote, isSelfServeSalesLed } from "@/lib/pricing-v2";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

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
  } = useForm<CreateOrgV2Form>({
    resolver: zodResolver(createOrgV2Schema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      primaryColor: "#1e3a5f",
      billingInterval: "month",
      actives: 0,
      alumni: 0,
    },
  });

  const formValues = watch();
  const { name, slug, primaryColor, billingInterval, actives, alumni } = formValues;

  const q = useMemo(
    () => quote({ tier: "single", actives: actives || 0, alumni: alumni || 0 }),
    [actives, alumni],
  );
  const salesLed = isSelfServeSalesLed({
    tier: "single",
    actives: actives || 0,
    alumni: alumni || 0,
  });
  const monthlyCents = q.monthlyCents;
  const yearlyCents = q.yearlyCents;
  const displayCents = billingInterval === "year" ? yearlyCents : monthlyCents;
  const intervalLabel = billingInterval === "year" ? "/yr" : "/mo";

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: name?.trim() || "",
        slug: slug?.trim() || "",
        description: formValues.description?.trim() || "",
        primaryColor: primaryColor || "",
        billingInterval,
        actives: actives || 0,
        alumni: alumni || 0,
      }),
    [actives, alumni, billingInterval, formValues.description, name, primaryColor, slug],
  );
  const { idempotencyKey } = useIdempotencyKey({
    storageKey: "create-org-v2-checkout",
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

  const handleNext = async () => {
    const valid = await trigger(["name", "slug", "primaryColor"]);
    if (valid) setStep(2);
  };

  const onSubmit = async (data: CreateOrgV2Form) => {
    setIsLoading(true);
    setError(null);
    setInfoMessage(null);
    if (!idempotencyKey) {
      setError("Preparing checkout... please try again.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/stripe/create-org-v2-checkout", {
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
          idempotencyKey,
        }),
      });

      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.error || "Unable to start checkout");

      if (responseData.mode === "sales") {
        setInfoMessage("Thank you! We will contact you to finalize a custom plan.");
        router.push(`/app?org=${data.slug}&billing=pending-sales`);
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
            <Button variant="ghost" size="sm" type="submit">Sign Out</Button>
          </form>
        </div>
      </header>

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
            <p className="text-sm font-medium text-muted-foreground mb-1">Step {step} of 2</p>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {step === 1 ? "Your Organization" : "Plan & Billing"}
            </h2>
            <p className="text-muted-foreground">
              {step === 1
                ? "Set up your team, club, or group. You’ll be the admin and can invite members later."
                : "Tell us about your size — pricing scales with your active members and alumni."}
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
            <InlineBanner variant="success" className="mb-6">{infoMessage}</InlineBanner>
          )}

          <form onSubmit={handleSubmit(onSubmit)}>
            {step === 1 && (
              <div className="space-y-6">
                <Input
                  label="Organization Name"
                  type="text"
                  placeholder="e.g., Stanford Crew, The Whiffenpoofs"
                  error={errors.name?.message}
                  {...register("name", { onChange: (e) => handleNameChange(e.target.value) })}
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
                    <Button type="button" variant="secondary" className="w-full">Cancel</Button>
                  </Link>
                  <Button type="button" className="flex-1" onClick={handleNext}>Next</Button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
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
                        {interval === "month" ? "Monthly" : "Yearly (save 17%)"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                </div>

                <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm space-y-2">
                  <p className="font-semibold text-foreground">Pricing Summary</p>
                  {salesLed ? (
                    <p className="text-muted-foreground">
                      Custom quote &mdash; we&apos;ll contact you to finalize pricing for your network size.
                    </p>
                  ) : displayCents > 0 ? (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Active members ({actives || 0})</span>
                        <span>{formatCents(q.breakdown.activeMonthlyCents)}/mo</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Alumni ({alumni || 0})</span>
                        <span>{formatCents(q.breakdown.alumniMonthlyCents)}/mo</span>
                      </div>
                      <div className="border-t border-border my-1" />
                      <div className="flex justify-between font-medium text-foreground">
                        <span>Total</span>
                        <span>{formatCents(displayCents)}{intervalLabel}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Add active members or alumni to see pricing.
                    </p>
                  )}
                </div>

                {salesLed && (
                  <InlineBanner variant="warning">
                    With {alumni?.toLocaleString()} alumni, we will contact you with custom pricing. No payment is collected now and the org remains pending_sales.
                  </InlineBanner>
                )}

                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep(1)}>Back</Button>
                  <Button type="submit" className="flex-1" isLoading={isLoading} disabled={submitDisabled}>
                    {salesLed ? "Contact Sales" : "Create Organization"}
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
