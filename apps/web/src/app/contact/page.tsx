import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Container } from "@/components/marketing/Container";
import { Section, SectionEyebrow } from "@/components/marketing/Section";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import "../landing-styles.css";

export const metadata: Metadata = {
  title: "Contact Sales — TeamNetwork",
  description: "Get in touch for TeamNetwork contract pricing.",
};

export default function ContactPage() {
  return (
    <MarketingShell>
      <Section padY="lg">
        <Container size="sm" className="text-center">
          <SectionEyebrow centered>Contact</SectionEyebrow>

          <h1 className="scroll-reveal display-section text-landing-cream">
            Let&apos;s build it <span className="accent-italic">together.</span>
          </h1>

          <p className="scroll-reveal mx-auto mt-5 max-w-xl text-lg leading-relaxed text-landing-cream/55">
            Tell us about your organization, network size, and rollout goals. We&apos;ll get back to
            you with contract pricing and next steps.
          </p>

          <div className="scroll-reveal mt-10 flex flex-col items-center gap-5">
            <ButtonLink
              href="mailto:sales@myteamnetwork.com?subject=TeamNetwork%20Pricing%20Inquiry"
              variant="landingPrimary"
              size="xl"
            >
              Email Sales
            </ButtonLink>

            <Link
              href="/#pricing"
              className="group inline-flex items-center gap-2 text-base text-landing-cream/55 transition-colors hover:text-landing-cream"
            >
              <svg
                className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to pricing</span>
            </Link>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
