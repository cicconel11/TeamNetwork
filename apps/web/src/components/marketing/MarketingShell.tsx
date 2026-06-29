import type { ReactNode } from "react";
import {
  BackToTop,
  LandingAnimations,
  LandingHeader,
} from "@/components/marketing/LandingClientComponents";
import { LandingFooter } from "@/components/marketing/LandingFooter";

/**
 * Shared chrome for marketing sub-pages (contact, support, demos, blog, terms,
 * privacy, pricing/calculator). Mirrors the landing page's header, footer, and
 * type-led palette, but with a calm static green glow over navy instead of the
 * animated mesh + constellation so dense content stays readable.
 *
 * Pages render their own <Section>/<Container> content as children; `.scroll-reveal`
 * elements are activated by <LandingAnimations />.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div
      id="top"
      className="landing-page relative min-h-screen overflow-x-clip bg-landing-navy text-landing-cream"
    >
      <LandingAnimations />

      {/* Soft ambient glow at the top — the only background treatment on sub-pages */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(34,197,94,0.10),transparent_70%)]"
      />

      <LandingHeader />

      <main className="relative z-10">{children}</main>

      <LandingFooter />

      <BackToTop />
    </div>
  );
}
