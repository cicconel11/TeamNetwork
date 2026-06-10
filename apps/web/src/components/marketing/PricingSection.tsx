"use client";

import { ButtonLink } from "@/components/ui";

const CONTRACT_POINTS = [
  {
    title: "Scoped to your organization",
    description:
      "We price around your active members, alumni network, fundraising needs, and rollout timeline.",
  },
  {
    title: "Built for budget review",
    description:
      "We can work with school, nonprofit, booster, alumni, and enterprise purchasing processes.",
  },
  {
    title: "No public rate card",
    description:
      "Your quote reflects the modules, support, data migration, and contract terms you actually need.",
  },
];

export function PricingSection({ showCta = true }: { showCta?: boolean }) {
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
            Contract pricing for your <span className="text-landing-green">network</span>
          </h2>
          <p className="scroll-reveal text-landing-cream/60 max-w-2xl mx-auto text-lg">
            TeamNetwork pricing is tailored to each organization. Tell us about
            your program and we&apos;ll put together a plan that fits your size,
            rollout, and support needs.
          </p>
        </div>

        <div
          suppressHydrationWarning
          className="scroll-reveal rounded-2xl border border-landing-cream/10 bg-landing-navy-light/50 p-6 sm:p-8"
        >
          <div className="grid md:grid-cols-3 gap-5 mb-8">
            {CONTRACT_POINTS.map((point) => (
              <div key={point.title} className="pricing-card rounded-2xl p-6">
                <h3 className="font-display text-lg font-bold text-landing-cream mb-2">
                  {point.title}
                </h3>
                <p className="text-sm leading-relaxed text-landing-cream/55">
                  {point.description}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-landing-navy/60 p-6 text-center">
            <p className="text-landing-cream/50 text-xs uppercase tracking-[0.18em] mb-3">
              Next step
            </p>
            <h3 className="font-display text-2xl sm:text-3xl font-bold text-landing-cream mb-3">
              Contact us for pricing
            </h3>
            <p className="text-landing-cream/60 max-w-2xl mx-auto">
              We&apos;ll review your organization size, use cases, and timeline,
              then send a contract-based quote instead of asking you to choose a
              public self-serve plan.
            </p>
          </div>

          {showCta && (
            <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
              <ButtonLink
                href="/contact"
                variant="landingPrimary"
                className="px-6 py-3"
              >
                Contact us for pricing
              </ButtonLink>
              <ButtonLink
                href="/demos"
                variant="landingSecondary"
                className="px-6 py-3 font-semibold"
              >
                View demos
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
