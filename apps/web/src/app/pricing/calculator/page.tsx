"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { LandingHeader } from "@/components/marketing/LandingHeader";
import { useIdempotencyKey } from "@/hooks";
import { quote, type Tier, type Interval } from "@/lib/pricing-v2";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatCents(cents: number): string {
  return currencyFmt.format(cents / 100);
}

export default function PricingCalculatorPage() {
  const searchParams = useSearchParams();
  const checkoutStatus = searchParams.get("checkout");

  const [tier, setTier] = useState<Tier>("single");
  const [actives, setActives] = useState(200);
  const [alumni, setAlumni] = useState(1_200);
  const [subOrgs, setSubOrgs] = useState(0);
  const [interval, setInterval] = useState<Interval>("month");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [salesNotice, setSalesNotice] = useState<string | null>(null);

  const q = useMemo(
    () => quote({ tier, actives, alumni, subOrgs }),
    [tier, actives, alumni, subOrgs],
  );

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        tier,
        actives,
        alumni,
        subOrgs: tier === "enterprise" ? subOrgs : 0,
        interval,
        monthlyCents: q.monthlyCents,
        yearlyCents: q.yearlyCents,
      }),
    [tier, actives, alumni, subOrgs, interval, q.monthlyCents, q.yearlyCents],
  );

  const { idempotencyKey } = useIdempotencyKey({
    storageKey: "dynamic_quote_checkout",
    fingerprint,
  });

  useEffect(() => {
    setSalesNotice(null);
  }, [tier, actives, alumni, subOrgs]);

  const onCheckout = async () => {
    if (q.salesLed || submitting) return;
    if (!idempotencyKey) {
      setError("Preparing checkout — try again.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/create-custom-quote-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          actives,
          alumni,
          subOrgs: tier === "enterprise" ? subOrgs : 0,
          billingInterval: interval,
          idempotencyKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to start checkout");
      }
      if (data.mode === "sales") {
        setSalesNotice(data.message || "Contact sales");
        return;
      }
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl as string);
        return;
      }
      throw new Error("Missing checkout URL");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const monthly = formatCents(q.monthlyCents);
  const yearly = formatCents(q.yearlyCents);

  const segBtn = (active: boolean) =>
    `flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all border ${
      active
        ? "border-landing-green bg-landing-green/15 text-landing-cream"
        : "border-landing-cream/15 bg-landing-cream/[0.03] text-landing-cream/65 hover:text-landing-cream hover:bg-landing-cream/[0.06]"
    }`;

  const inputCls =
    "w-full rounded-lg border border-landing-cream/15 bg-landing-cream/[0.03] px-3 py-2.5 text-landing-cream placeholder:text-landing-cream/30 focus:outline-none focus:ring-2 focus:ring-landing-green/40 focus:border-landing-green/40";

  return (
    <div className="landing-page relative min-h-screen overflow-x-clip bg-landing-navy text-landing-cream noise-overlay">
      <div className="fixed inset-0 bg-gradient-to-b from-landing-navy via-landing-navy to-landing-navy/95 pointer-events-none" />
      <div className="relative z-10">
        <LandingHeader />
        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-16">
          <div className="mb-8">
            <span className="inline-block px-3 py-1 rounded-full bg-landing-green/10 border border-landing-green/30 text-landing-green text-xs font-semibold uppercase tracking-[0.2em]">
              Preview / Test
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-landing-cream mt-4">
              Pricing <span className="text-landing-green">Calculator</span>
            </h1>
            <p className="text-landing-cream/60 mt-3 text-lg">
              Live calculator for the v2 per-user pricing model. Not yet the
              production plan.
            </p>
          </div>

          {checkoutStatus === "success" && (
            <div className="mb-6 p-4 rounded-xl border border-landing-green/30 bg-landing-green/10 text-landing-cream">
              Checkout completed. The webhook should mark the payment attempt as
              succeeded.
            </div>
          )}
          {checkoutStatus === "cancel" && (
            <div className="mb-6 p-4 rounded-xl border border-landing-cream/15 bg-landing-cream/[0.04] text-landing-cream/80">
              Checkout canceled.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-landing-cream/10 bg-landing-navy-light/50 p-6 space-y-5">
              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-[0.18em] text-landing-cream/50">
                  Tier
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setTier("single")} className={segBtn(tier === "single")}>
                    Single org
                  </button>
                  <button type="button" onClick={() => setTier("enterprise")} className={segBtn(tier === "enterprise")}>
                    Enterprise
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-[0.18em] text-landing-cream/50">
                  Billing interval
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setInterval("month")} className={segBtn(interval === "month")}>
                    Monthly
                  </button>
                  <button type="button" onClick={() => setInterval("year")} className={segBtn(interval === "year")}>
                    Yearly · Save 17%
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-[0.18em] text-landing-cream/50">
                  Active members
                </label>
                <input
                  type="number"
                  min={0}
                  value={actives}
                  onChange={(e) => setActives(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className={inputCls}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-[0.18em] text-landing-cream/50">
                  Alumni
                </label>
                <input
                  type="number"
                  min={0}
                  value={alumni}
                  onChange={(e) => setAlumni(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className={inputCls}
                />
              </div>

              {tier === "enterprise" && (
                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-[0.18em] text-landing-cream/50">
                    Sub-organizations
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={subOrgs}
                    onChange={(e) => setSubOrgs(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className={inputCls}
                  />
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-landing-cream/10 bg-landing-navy-light/50 p-6">
              <h2 className="font-display text-lg font-bold text-landing-cream mb-4">Quote</h2>

              {q.salesLed ? (
                <div className="p-4 rounded-lg border border-landing-green/30 bg-landing-green/10 text-sm text-landing-cream/80">
                  Custom alumni quota — contact sales for plans above 100,000
                  alumni.
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <Row
                    label={`Alumni (${alumni.toLocaleString()} × ${formatCents(q.breakdown.alumniRateCents)})`}
                    value={formatCents(q.breakdown.alumniMonthlyCents)}
                  />
                  <Row
                    label={`Active members (${actives.toLocaleString()} × ${formatCents(q.breakdown.activeRateCents)})`}
                    value={formatCents(q.breakdown.activeMonthlyCents)}
                  />
                  {q.breakdown.platformBaseCents > 0 && (
                    <Row
                      label="Enterprise platform base"
                      value={formatCents(q.breakdown.platformBaseCents)}
                    />
                  )}
                  {q.breakdown.subOrgMonthlyCents > 0 && (
                    <Row
                      label={`Sub-orgs (${q.breakdown.subOrgsBilled} blended)`}
                      value={formatCents(q.breakdown.subOrgMonthlyCents)}
                    />
                  )}
                  <div className="border-t border-landing-cream/10 my-3" />
                  <div className="flex items-baseline justify-between">
                    <span className="text-landing-cream/70">Monthly</span>
                    <span className="athletic-number text-2xl text-landing-cream">{monthly}<span className="text-sm text-landing-cream/50">/mo</span></span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-landing-cream/70">Yearly</span>
                    <span className="athletic-number text-2xl text-landing-cream">{yearly}<span className="text-sm text-landing-cream/50">/yr</span></span>
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
                  {error}
                </div>
              )}

              {salesNotice && (
                <div className="mt-4 p-3 rounded-lg border border-landing-green/30 bg-landing-green/10 text-sm text-landing-cream/80">
                  {salesNotice}
                </div>
              )}

              <button
                type="button"
                className="w-full mt-6 rounded-lg bg-landing-green-dark hover:bg-[#15803d] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 transition-colors"
                onClick={onCheckout}
                disabled={submitting || q.salesLed || q.monthlyCents <= 0}
              >
                {submitting ? "Starting checkout…" : q.salesLed ? "Contact Sales" : "Test checkout"}
              </button>
              <p className="text-xs text-landing-cream/50 mt-2 text-center">
                Will charge{" "}
                <span className="font-medium text-landing-cream">
                  {interval === "year" ? `${yearly}/yr` : `${monthly}/mo`}
                </span>{" "}
                via Stripe (test mode).
              </p>
            </div>
          </div>

          <div className="mt-10 text-center">
            <ButtonLink
              href="/#pricing"
              variant="custom"
              className="text-landing-cream/60 hover:text-landing-cream text-sm"
            >
              ← Back to pricing
            </ButtonLink>
          </div>
        </main>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between items-baseline border-b border-landing-cream/5 pb-2 last:border-0">
      <span className="text-landing-cream/65">{label}</span>
      <span className="font-semibold text-landing-cream">{value}</span>
    </div>
  );
}
