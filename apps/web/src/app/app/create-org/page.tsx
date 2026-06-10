"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Card, Textarea, InlineBanner } from "@/components/ui";
import { createOrgV2Schema, type CreateOrgV2Form } from "@/lib/schemas/organization-v2";

function buildPricingMailto(data: CreateOrgV2Form) {
  const subject = encodeURIComponent(`TeamNetwork pricing request: ${data.name}`);
  const body = encodeURIComponent(
    [
      "Hi TeamNetwork,",
      "",
      "I'd like contract pricing for a new organization.",
      "",
      `Organization: ${data.name}`,
      `Slug: ${data.slug}`,
      `Active members: ${data.actives ?? 0}`,
      `Alumni: ${data.alumni ?? 0}`,
      data.description ? `Description: ${data.description}` : null,
      "",
      "Please send pricing and next steps.",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return `mailto:sales@myteamnetwork.com?subject=${subject}&body=${body}`;
}

export default function CreateOrgPage() {
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

  const { slug, primaryColor } = watch();

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

  const onSubmit = (data: CreateOrgV2Form) => {
    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      window.location.href = buildPricingMailto(data);
      setInfoMessage("Opening your email app so you can request contract pricing.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open email.");
    } finally {
      setIsLoading(false);
    }
  };

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
              {step === 1 ? "Your Organization" : "Pricing Request"}
            </h2>
            <p className="text-muted-foreground">
              {step === 1
                ? "Tell us what you are building. We will use this to prepare your workspace and pricing conversation."
                : "Share your organization size so we can send contract pricing and next steps."}
            </p>
          </div>

          {error && <InlineBanner variant="error" className="mb-6">{error}</InlineBanner>}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Active Members"
                    type="number"
                    min={0}
                    helperText="Current roster, staff, volunteers, or active community members."
                    error={errors.actives?.message}
                    {...register("actives", { valueAsNumber: true })}
                  />
                  <Input
                    label="Alumni"
                    type="number"
                    min={0}
                    helperText="Past members, graduates, supporters, or long-term contacts."
                    error={errors.alumni?.message}
                    {...register("alumni", { valueAsNumber: true })}
                  />
                </div>

                <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                  <p className="font-semibold text-foreground">Contract pricing</p>
                  <p className="mt-2 text-muted-foreground">
                    We no longer show self-serve rates here. Send us your org
                    details and we&apos;ll follow up with pricing based on your
                    size, modules, support needs, and rollout timing.
                  </p>
                </div>

                <div className="flex gap-4 pt-4">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep(1)}>Back</Button>
                  <Button type="submit" className="flex-1" isLoading={isLoading}>
                    Contact us for pricing
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
