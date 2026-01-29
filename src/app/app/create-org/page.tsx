 "use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Input, Card, Textarea } from "@/components/ui";
import { FeedbackButton } from "@/components/feedback";
import { useIdempotencyKey } from "@/hooks";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export default function CreateOrgPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#1e3a5f");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<SubscriptionInterval>("month");
  const [alumniBucket, setAlumniBucket] = useState<AlumniBucket>("none");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: name.trim() || "",
        slug: slug.trim() || "",
        description: description.trim() || "",
        primaryColor: primaryColor || "",
        billingInterval,
        alumniBucket,
      }),
    [alumniBucket, billingInterval, description, name, primaryColor, slug],
  );
  const { idempotencyKey } = useIdempotencyKey({
    storageKey: "create-org-checkout",
    fingerprint,
  });

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    // Generate slug: lowercase, replace spaces with hyphens, remove special chars
    const generatedSlug = value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    setSlug(generatedSlug);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setInfoMessage(null);
    if (!idempotencyKey) {
      setError("Preparing checkout... please try again.");
      setIsLoading(false);
      return;
    }

    try {
      console.log("Creating org checkout with:", { name, slug, billingInterval, alumniBucket });
      
      const response = await fetch("/api/stripe/create-org-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          description,
          primaryColor,
          billingInterval,
          alumniBucket,
          idempotencyKey,
        }),
      });

      const data = await response.json();
      console.log("Create org response:", response.status, data);

      if (!response.ok) {
        throw new Error(data.error || "Unable to start checkout");
      }

      if (data.mode === "sales") {
        setInfoMessage("Thank you! We will contact you to finalize a custom alumni plan.");
        router.push(`/app?org=${slug}&billing=pending-sales`);
        return;
      }

      if (data.url) {
        console.log("Redirecting to Stripe:", data.url);
        window.location.href = data.url as string;
        return;
      }

      throw new Error("Missing checkout URL");
    } catch (err) {
      console.error("Create org error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app">
            <h1 className="text-2xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
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
            <h2 className="text-2xl font-bold text-foreground mb-2">Create a New Organization</h2>
            <p className="text-muted-foreground">
              Set up your team, club, or group. You&apos;ll be the admin and can invite members later.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
              <div className="mt-2 flex justify-end">
                <FeedbackButton context="create-org" trigger="checkout_error" />
              </div>
            </div>
          )}
          {infoMessage && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm">
              {infoMessage}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              <Input
                label="Organization Name"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., Stanford Crew, The Whiffenpoofs"
                required
              />

              <div>
                <Input
                  label="URL Slug"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="my-organization"
                  helperText={`Your organization will be at: teamnetwork.app/${slug || "your-slug"}`}
                  required
                />
              </div>

              <Textarea
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell people about your organization..."
                rows={3}
              />

              <div className="p-4 rounded-xl bg-muted/50 text-sm space-y-2">
                <p className="font-semibold text-foreground">Pricing</p>
                <p className="text-muted-foreground">Active Team (Required): $15/mo or $150/yr.</p>
                <p className="text-muted-foreground">
                  Alumni Add-On (Optional): 0–250: +$10/mo or $100/yr; 251–500: +$20/mo or $200/yr; 501–1,000: +$35/mo or $350/yr; 1,001–2,500: +$60/mo or $600/yr; 2,500–5,000: +$100/mo or $1,000/yr.
                </p>
                <p className="text-muted-foreground">
                  5,000+ alumni routes to a custom quote (no checkout; we will contact you).
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Brand Color
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-12 w-20 rounded-xl border border-border cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#1e3a5f"
                    className="flex-1"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  This color will be used for your organization&apos;s branding
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Billing Interval</p>
                  <div className="flex gap-2">
                    {["month", "year"].map((interval) => (
                      <button
                        key={interval}
                        type="button"
                        onClick={() => setBillingInterval(interval as SubscriptionInterval)}
                        className={`flex-1 px-4 py-3 rounded-xl border ${
                          billingInterval === interval
                            ? "border-org-primary bg-org-primary text-white"
                            : "border-border bg-muted text-foreground"
                        }`}
                      >
                        {interval === "month" ? "Monthly" : "Yearly (save 2 months)"}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Monthly = $15/mo base. Yearly = $150/yr (save 2 months).
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Alumni Access</p>
                  <select
                    value={alumniBucket}
                    onChange={(e) => setAlumniBucket(e.target.value as AlumniBucket)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-org-primary"
                  >
                    <option value="none">No alumni access</option>
                    <option value="0-250">0–250 alumni</option>
                    <option value="251-500">251–500 alumni</option>
                    <option value="501-1000">501–1,000 alumni</option>
                    <option value="1001-2500">1,001–2,500 alumni</option>
                    <option value="2500-5000">2,500–5,000 alumni</option>
                    <option value="5000+">Over 5,000 (custom pricing)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Alumni access adds read access for alumni directories and communications; pricing scales by bucket.
                  </p>
                </div>
              </div>

              {alumniBucket === "5000+" && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
                  For 5,000+ alumni, we will contact you with custom pricing. No payment is collected now and the org will remain pending_sales.
                </div>
              )}

              <div className="flex gap-4 pt-4">
                <Link href="/app" className="flex-1">
                  <Button type="button" variant="secondary" className="w-full">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" className="flex-1" isLoading={isLoading}>
                  Create Organization
                </Button>
              </div>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
