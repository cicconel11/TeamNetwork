import { ButtonLink } from "@/components/ui";
import { LandingHeader } from "@/components/marketing/LandingHeader";

export default function PricingCalculatorPage() {
  return (
    <div className="landing-page relative min-h-screen overflow-x-clip bg-landing-navy text-landing-cream noise-overlay">
      <div className="fixed inset-0 bg-gradient-to-b from-landing-navy via-landing-navy to-landing-navy/95 pointer-events-none" />
      <div className="relative z-10">
        <LandingHeader />
        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-24 text-center">
          <span className="inline-block px-3 py-1 rounded-full bg-landing-green/10 border border-landing-green/30 text-landing-green text-xs font-semibold uppercase tracking-[0.2em]">
            Pricing
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-landing-cream mt-5">
            Contact us for pricing
          </h1>
          <p className="text-landing-cream/60 mt-4 text-lg leading-relaxed">
            We no longer publish a self-serve pricing calculator. TeamNetwork
            pricing is contract-based and tailored to your organization&apos;s
            size, modules, support needs, and rollout plan.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <ButtonLink href="/contact" variant="landingPrimary" className="px-6 py-3">
              Contact sales
            </ButtonLink>
            <ButtonLink href="/#pricing" variant="landingSecondary" className="px-6 py-3">
              Back to pricing
            </ButtonLink>
          </div>
        </main>
      </div>
    </div>
  );
}
