"use client";

import { useMemo, useState } from "react";
import { ButtonLink } from "@/components/ui";
import { quote, type Interval } from "@/lib/pricing-v2";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function fmt(cents: number) {
  return currencyFmt.format(cents / 100);
}

const ALUMNI_SLABS: { label: string; rateCents: number }[] = [
  { label: "1 – 500", rateCents: 36 },
  { label: "501 – 2,500", rateCents: 25 },
  { label: "2,501 – 10,000", rateCents: 18 },
  { label: "10,001 – 25,000", rateCents: 13 },
];

const ACTIVE_SLABS: { label: string; rateCents: number }[] = [
  { label: "1 – 100", rateCents: 15 },
  { label: "101 – 500", rateCents: 10 },
  { label: "501+", rateCents: 5 },
];

const SCENARIOS = [
  {
    key: "club",
    title: "Club",
    blurb: "25 active members, no alumni yet",
    actives: 25,
    alumni: 0,
    tier: "single" as const,
    subOrgs: 0,
  },
  {
    key: "small",
    title: "Small program",
    blurb: "200 active members, 750 alumni",
    actives: 200,
    alumni: 750,
    tier: "single" as const,
    subOrgs: 0,
  },
  {
    key: "midsize",
    title: "Midsize school",
    blurb: "500 actives, 5,000 alumni",
    actives: 500,
    alumni: 5_000,
    tier: "single" as const,
    subOrgs: 0,
  },
  {
    key: "enterprise",
    title: "University network",
    blurb: "1,000 actives · 20,000 alumni · 15 sub-orgs",
    actives: 1_000,
    alumni: 20_000,
    tier: "enterprise" as const,
    subOrgs: 15,
  },
];

export function PricingSection({ showCta = true }: { showCta?: boolean }) {
  const [interval, setInterval] = useState<Interval>("month");
  const [scenarioKey, setScenarioKey] = useState<string>("small");

  const scenario = SCENARIOS.find((s) => s.key === scenarioKey) ?? SCENARIOS[0];

  const q = useMemo(
    () =>
      quote({
        tier: scenario.tier,
        actives: scenario.actives,
        alumni: scenario.alumni,
        subOrgs: scenario.subOrgs,
      }),
    [scenario],
  );

  const totalCents = interval === "year" ? q.yearlyCents : q.monthlyCents;
  const intervalLabel = interval === "year" ? "/yr" : "/mo";

  return (
    <section id="pricing" className="relative z-10 py-24 px-6" suppressHydrationWarning>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div
            suppressHydrationWarning
            className="scroll-reveal inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6"
          >
            Pricing
          </div>
          <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold text-landing-cream mb-6">
            Priced <span className="text-landing-green">per user</span>
          </h2>
          <p className="scroll-reveal text-landing-cream/60 max-w-2xl mx-auto mb-10 text-lg">
            One rate per active member, one rate per alumni. Both drop as your
            roster grows. Over 100,000 alumni? <a href="mailto:sales@myteamnetwork.com" className="underline hover:text-landing-cream">Talk to us</a>.
          </p>

          <div
            suppressHydrationWarning
            role="group"
            aria-label="Billing interval"
            className="scroll-reveal inline-flex items-center bg-landing-navy-light rounded-full p-1.5 border border-landing-cream/10"
          >
            <button
              onClick={() => setInterval("month")}
              aria-pressed={interval === "month"}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all ${
                interval === "month"
                  ? "bg-landing-green-dark text-white shadow-lg"
                  : "text-landing-cream/60 hover:text-landing-cream"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval("year")}
              aria-pressed={interval === "year"}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
                interval === "year"
                  ? "bg-landing-green-dark text-white shadow-lg"
                  : "text-landing-cream/60 hover:text-landing-cream"
              }`}
            >
              Yearly
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  interval === "year"
                    ? "bg-white/20 text-white"
                    : "bg-landing-cream/10 text-landing-cream/60"
                }`}
              >
                Save 17%
              </span>
            </button>
          </div>
        </div>

        {/* Rate cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          <div className="pricing-card rounded-2xl p-7">
            <h3 className="font-display text-lg font-bold text-landing-cream mb-1">
              Active members
            </h3>
            <p className="text-landing-cream/50 text-sm mb-5">
              Per active member, per month. Drops as your active roster grows.
            </p>
            <ul className="space-y-2">
              {ACTIVE_SLABS.map((s) => (
                <li
                  key={s.label}
                  className="flex justify-between items-baseline text-sm border-b border-landing-cream/5 pb-2 last:border-0"
                >
                  <span className="text-landing-cream/70">{s.label} actives</span>
                  <span className="font-semibold text-landing-cream">
                    {fmt(s.rateCents)}/mo each
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pricing-card pricing-card-featured holo-border rounded-2xl p-7 relative">
            <h3 className="font-display text-lg font-bold text-landing-cream mb-1">
              Alumni
            </h3>
            <p className="text-landing-cream/50 text-sm mb-5">
              Per alumni, per month. Volume rates kick in automatically.
            </p>
            <ul className="space-y-2">
              {ALUMNI_SLABS.map((s) => (
                <li
                  key={s.label}
                  className="flex justify-between items-baseline text-sm border-b border-landing-cream/5 pb-2 last:border-0"
                >
                  <span className="text-landing-cream/70">{s.label} alumni</span>
                  <span className="font-semibold text-landing-cream">
                    {fmt(s.rateCents)}/mo each
                  </span>
                </li>
              ))}
              <li className="flex justify-between items-baseline text-sm pt-1">
                <span className="text-landing-cream/70">100,000+ alumni</span>
                <span className="font-semibold text-landing-green">
                  Contact sales
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Worked example */}
        <div
          suppressHydrationWarning
          className="scroll-reveal rounded-2xl border border-landing-cream/10 bg-landing-navy-light/50 p-6 sm:p-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h3 className="font-display text-lg font-bold text-landing-cream">
              See what you&apos;d actually pay
            </h3>
            <div className="flex flex-wrap gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setScenarioKey(s.key)}
                  aria-pressed={scenarioKey === s.key}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                    scenarioKey === s.key
                      ? "bg-landing-green-dark text-white border-landing-green-dark"
                      : "border-landing-cream/15 text-landing-cream/60 hover:text-landing-cream"
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>

          <p className="text-landing-cream/60 text-sm mb-5">{scenario.blurb}</p>

          <div className="grid sm:grid-cols-2 gap-6 items-start">
            <ul className="space-y-2 text-sm">
              <Row
                label={`${scenario.actives.toLocaleString()} actives × ${fmt(q.breakdown.activeRateCents)}`}
                value={`${fmt(q.breakdown.activeMonthlyCents)}/mo`}
              />
              <Row
                label={`${scenario.alumni.toLocaleString()} alumni × ${fmt(q.breakdown.alumniRateCents)}`}
                value={`${fmt(q.breakdown.alumniMonthlyCents)}/mo`}
              />
              {q.breakdown.platformBaseCents > 0 && (
                <Row
                  label="Enterprise platform base"
                  value={`${fmt(q.breakdown.platformBaseCents)}/mo`}
                />
              )}
              {q.breakdown.subOrgMonthlyCents > 0 && (
                <Row
                  label={`${q.breakdown.subOrgsBilled} sub-orgs (blended)`}
                  value={`${fmt(q.breakdown.subOrgMonthlyCents)}/mo`}
                />
              )}
            </ul>

            <div className="rounded-xl bg-landing-navy/60 p-5 text-center">
              <p className="text-landing-cream/50 text-xs uppercase tracking-[0.18em] mb-2">
                Your bill
              </p>
              <div className="flex items-baseline justify-center gap-2">
                <span className="athletic-number text-5xl text-landing-cream">
                  {fmt(totalCents)}
                </span>
                <span className="text-landing-cream/50">{intervalLabel}</span>
              </div>
              {interval === "year" && q.monthlyCents > 0 && (
                <p className="text-sm text-landing-cream/60 mt-2">
                  ≈ {fmt(Math.round(q.yearlyCents / 12))}/mo · 17% off
                </p>
              )}
              {interval === "month" && q.monthlyCents > 0 && (
                <p className="text-sm text-landing-cream/60 mt-2">
                  Pay yearly: {fmt(q.yearlyCents)}/yr (save 17%)
                </p>
              )}
            </div>
          </div>

          {showCta && (
            <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
              <ButtonLink
                href="/pricing/calculator"
                variant="custom"
                className="bg-landing-cream/10 hover:bg-landing-cream/20 text-landing-cream font-semibold px-6 py-3 border border-landing-cream/15"
              >
                Run your own numbers
              </ButtonLink>
              <ButtonLink
                href="/auth/signup"
                variant="custom"
                className="bg-landing-green-dark hover:bg-landing-green-dark/90 text-white font-semibold px-6 py-3"
              >
                Get Started
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between items-baseline border-b border-landing-cream/5 pb-2 last:border-0">
      <span className="text-landing-cream/70">{label}</span>
      <span className="font-semibold text-landing-cream">{value}</span>
    </li>
  );
}
