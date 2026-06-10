"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Card, Textarea, InlineBanner } from "@/components/ui";
import {
  createEnterpriseV2Schema,
  type CreateEnterpriseV2Form,
} from "@/lib/schemas/organization-v2";

function buildEnterprisePricingMailto(data: CreateEnterpriseV2Form) {
  const subject = encodeURIComponent(`TeamNetwork enterprise pricing request: ${data.name}`);
  const body = encodeURIComponent(
    [
      "Hi TeamNetwork,",
      "",
      "I'd like contract pricing for an enterprise account.",
      "",
      `Enterprise: ${data.name}`,
      `Slug: ${data.slug}`,
      `Billing contact: ${data.billingContactEmail}`,
      `Active members: ${data.actives ?? 0}`,
      `Alumni: ${data.alumni ?? 0}`,
      `Sub-organizations: ${data.subOrgs ?? 0}`,
      data.description ? `Description: ${data.description}` : null,
      "",
      "Please send pricing and next steps.",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return `mailto:sales@myteamnetwork.com?subject=${subject}&body=${body}`;
}

export default function CreateEnterprisePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

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

  const onSubmit = (data: CreateEnterpriseV2Form) => {
    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      window.location.href = buildEnterprisePricingMailto(data);
      setInfoMessage("Opening your email app so you can request enterprise pricing.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open email.");
    } finally {
      setIsLoading(false);
    }
  };

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
                  Tell us about your enterprise network and we&apos;ll follow up
                  with contract pricing and implementation next steps.
                </p>
              </div>

              {error && <InlineBanner variant="error" className="mb-6">{error}</InlineBanner>}
              {infoMessage && (
                <InlineBanner variant="success" className="mb-6">{infoMessage}</InlineBanner>
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

                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-semibold text-foreground">Contract pricing</p>
                    <p className="mt-2 text-muted-foreground">
                      Enterprise pricing depends on network structure, migration
                      support, data needs, rollout timing, and contract terms. No
                      payment is collected here.
                    </p>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Link href="/app" className="flex-1">
                      <Button type="button" variant="secondary" className="w-full">Cancel</Button>
                    </Link>
                    <Button type="submit" className="flex-1" isLoading={isLoading}>
                      Contact us for pricing
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-8">
              <h3 className="font-semibold text-foreground mb-3">What happens next</h3>
              <p className="text-sm text-muted-foreground">
                We&apos;ll review your requested enterprise size, confirm the
                rollout model, and send a contract-based quote. Your account is
                not charged from this page.
              </p>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
