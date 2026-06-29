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
    <section id="pricing" className="relative z-10 px-6 py-24 sm:py-32" suppressHydrationWarning>
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <div suppressHydrationWarning className="scroll-reveal eyebrow-label is-centered mb-6">
            Pricing
          </div>
          <h2 className="scroll-reveal display-section mb-6 text-landing-cream">
            Contract pricing for your <span className="accent-italic">network.</span>
          </h2>
          <p className="scroll-reveal mx-auto max-w-2xl text-lg leading-relaxed text-landing-cream/60">
            TeamNetwork pricing is tailored to each organization. Tell us about
            your program and we&apos;ll put together a plan that fits your size,
            rollout, and support needs.
          </p>
        </div>

        <div className="scroll-reveal grid gap-10 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/10">
          {CONTRACT_POINTS.map((point) => (
            <div key={point.title} className="sm:px-8 sm:first:pl-0 sm:last:pr-0">
              <h3 className="mb-2 font-display text-lg font-bold text-landing-cream">
                {point.title}
              </h3>
              <p className="text-sm leading-relaxed text-landing-cream/55">
                {point.description}
              </p>
            </div>
          ))}
        </div>

        <div className="hairline my-16" />

        <div className="text-center">
          <p className="scroll-reveal eyebrow-label is-centered mb-5">Next step</p>
          <h3 className="scroll-reveal display-section mb-5 text-3xl text-landing-cream sm:text-4xl">
            Contact us for pricing
          </h3>
          <p className="scroll-reveal mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-landing-cream/60">
            We&apos;ll review your organization size, use cases, and timeline,
            then send a contract-based quote instead of asking you to choose a
            public self-serve plan.
          </p>

          {showCta && (
            <div className="scroll-reveal flex flex-wrap items-center justify-center gap-3">
              <ButtonLink href="/contact" variant="landingPrimary" size="xl">
                Contact us for pricing
              </ButtonLink>
              <ButtonLink href="/demos" variant="landingSecondary" size="xl">
                View demos
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
