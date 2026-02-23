"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ButtonLink } from "@/components/ui";
import {
  BASE_PRICES,
  ALUMNI_ADD_ON_PRICES,
  ALUMNI_BUCKET_LABELS,
  getTotalPrice,
  formatPrice,
} from "@/lib/pricing";
import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

const EnterprisePricingModal = dynamic(
  () =>
    import("@/components/marketing/EnterprisePricingModal").then(
      (mod) => mod.EnterprisePricingModal
    ),
  { ssr: false }
);

const ALUMNI_TIERS: Exclude<AlumniBucket, "none">[] = [
  "0-250",
  "251-500",
  "501-1000",
  "1001-2500",
  "2500-5000",
  "5000+",
];

export function PricingSection({ showCta = true }: { showCta?: boolean }) {
  const [interval, setInterval] = useState<SubscriptionInterval>("month");
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);

  return (
    <section id="pricing" className="relative z-10 py-24 px-6" suppressHydrationWarning>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div suppressHydrationWarning className="scroll-reveal inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6">
            Pricing
          </div>
          <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold text-landing-cream mb-6">
            Simple, <span className="text-landing-cream">Transparent</span> Pricing
          </h2>
          <p className="scroll-reveal text-landing-cream/60 max-w-2xl mx-auto mb-10 text-lg">
            One base price for unlimited active members. Add alumni access only if you need it.
          </p>

          {/* Toggle */}
          <div suppressHydrationWarning className="scroll-reveal inline-flex items-center bg-landing-navy-light rounded-full p-1.5 border border-landing-cream/10">
            <button
              onClick={() => setInterval("month")}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all ${interval === "month"
                ? "bg-landing-green-dark text-white shadow-lg"
                : "text-landing-cream/60 hover:text-landing-cream"
                }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval("year")}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${interval === "year"
                ? "bg-landing-green-dark text-white shadow-lg"
                : "text-landing-cream/60 hover:text-landing-cream"
                }`}
            >
              Yearly
              <span className={`text-xs px-2 py-0.5 rounded-full ${interval === "year"
                ? "bg-white/20 text-white"
                : "bg-landing-cream/10 text-landing-cream/60"
                }`}>
                Save 17%
              </span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Base Plan */}
          <div className="pricing-card rounded-2xl p-8 pt-10 relative">
            {/* Pick badge */}
            <div className="pick-badge">Starter Pick</div>

            {/* Corner accent */}
            <div className="absolute top-0 right-0 w-24 h-24">
              <div className="absolute inset-0 bg-gradient-to-bl from-landing-green/10 to-transparent" />
            </div>

            <div className="relative">
              <div className="mb-6">
                <h3 className="font-display text-xl font-bold text-landing-cream mb-2">Active Team</h3>
                <p className="text-landing-cream/50 text-sm">Everything you need for current members</p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-2">
                  <span className="athletic-number text-5xl">{formatPrice(BASE_PRICES[interval], interval).replace('/mo', '').replace('/yr', '')}</span>
                  <span className="text-landing-cream/50">/{interval === "month" ? "mo" : "yr"}</span>
                </div>
                {interval === "year" && (
                  <p className="text-sm text-landing-cream/70 mt-2">
                    That&apos;s just $12.50/mo
                  </p>
                )}
              </div>

              <ul className="space-y-4 mb-8">
                {[
                  "Unlimited active members",
                  "Member directory & profiles",
                  "Events & calendar",
                  "Announcements",
                  "Donations via Stripe Connect",
                  "Forms & document uploads",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-landing-cream/70">
                    <svg className="w-5 h-5 text-landing-green flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>

              {showCta && (
                <ButtonLink href="/auth/signup" variant="custom" className="w-full bg-landing-green-dark hover:bg-landing-green-dark/90 text-white font-semibold py-3">
                  Get Started
                </ButtonLink>
              )}
            </div>
          </div>

          {/* Alumni Add-on */}
          <div className="pricing-card pricing-card-featured holo-border rounded-2xl p-8 pt-10 relative pulse-glow">
            {/* Pick badge */}
            <div className="pick-badge" style={{ background: "linear-gradient(135deg, #059669 0%, #34d399 100%)" }}>Pro Pick</div>

            {/* Featured badge */}
            <div className="absolute top-14 right-6">
              <span className="px-3 py-1 rounded-full bg-landing-green/20 text-landing-green text-xs font-semibold uppercase tracking-wider">
                Popular Add-On
              </span>
            </div>

            <div className="mb-6">
              <h3 className="font-display text-xl font-bold text-landing-cream mb-2">Alumni Access</h3>
              <p className="text-landing-cream/50 text-sm">Keep alumni connected with read access</p>
            </div>

            <div className="space-y-3 mb-8 bg-landing-navy/50 rounded-xl p-4">
              {ALUMNI_TIERS.map((tier) => {
                const prices = tier === "5000+" ? null : ALUMNI_ADD_ON_PRICES[tier];
                return (
                  <div key={tier} className="flex justify-between items-center text-sm py-1">
                    <span className="text-landing-cream/60">{ALUMNI_BUCKET_LABELS[tier]}</span>
                    <span className="font-mono font-semibold text-landing-cream">
                      {prices ? (
                        <>+{formatPrice(prices[interval], interval)}</>
                      ) : (
                        <span className="text-landing-green">Custom</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <ul className="space-y-4">
              {[
                "Alumni directory access",
                "View events & announcements",
                "Mentorship connections",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-landing-cream/70">
                  <svg className="w-5 h-5 text-landing-green flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Enterprise Teaser */}
        <div suppressHydrationWarning className="scroll-reveal mb-8">
          <button
            onClick={() => setEnterpriseOpen(true)}
            className="w-full pricing-card enterprise-card rounded-2xl p-6 relative text-left group"
            aria-label="View Enterprise Pricing"
          >
            {/* Amber corner accent */}
            <div className="absolute top-0 right-0 w-24 h-24 overflow-hidden rounded-2xl pointer-events-none">
              <div className="absolute inset-0 bg-gradient-to-bl from-amber-500/10 to-transparent" />
            </div>

            <div className="relative flex items-center justify-between gap-6">
              {/* Left: label + stats */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-3 py-1 rounded-full bg-amber-500/15 text-amber-400 text-xs font-semibold uppercase tracking-wider">
                    Enterprise
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-landing-cream mb-3">
                  Managing multiple teams?
                </h3>
                <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                  <span className="text-landing-cream/50 text-sm">
                    <span className="text-landing-green font-semibold">3 orgs free</span>
                  </span>
                  <span className="text-landing-cream/50 text-sm">
                    <span className="font-mono font-semibold text-landing-cream">$150/yr</span> per additional org
                  </span>
                  <span className="text-landing-cream/50 text-sm">
                    <span className="font-mono font-semibold text-landing-cream">$500/yr</span> per 2,500 alumni
                  </span>
                </div>
              </div>

              {/* Right: CTA */}
              <div className="flex-shrink-0 flex items-center gap-2 text-amber-400 group-hover:text-amber-300 transition-colors text-sm font-semibold whitespace-nowrap">
                Explore Enterprise
                <svg
                  className="w-4 h-4 group-hover:translate-x-1 transition-transform"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        </div>

        {/* Example calculation */}
        <div suppressHydrationWarning className="scroll-reveal text-center p-6 rounded-xl bg-landing-navy-light/50 border border-landing-cream/10">
          <p className="text-landing-cream/60">
            <span className="text-landing-cream font-semibold">Example:</span> Active Team + 251–500 alumni ={" "}
            <span className="font-mono font-bold text-landing-cream text-lg">
              {formatPrice(getTotalPrice(interval, "251-500")!, interval)}
            </span>
          </p>
        </div>
      </div>

      <EnterprisePricingModal
        open={enterpriseOpen}
        onClose={() => setEnterpriseOpen(false)}
        interval={interval}
      />
    </section>
  );
}
