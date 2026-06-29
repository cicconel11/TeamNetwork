import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Container } from "@/components/marketing/Container";
import { Section, SectionEyebrow } from "@/components/marketing/Section";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import "../landing-styles.css";

export const metadata: Metadata = {
  title: "Support — TeamNetwork",
  description: "Get help with TeamNetwork. Contact our support team for assistance.",
};

const SUPPORT_EMAIL = "mleonard@myteamnetwork.com";

export default function SupportPage() {
  return (
    <MarketingShell>
      <Section padY="lg">
        <Container size="sm" className="text-center">
          <SectionEyebrow centered>Support</SectionEyebrow>

          <h1 className="scroll-reveal display-section text-landing-cream">
            Here when you <span className="accent-italic">need us.</span>
          </h1>

          <p className="scroll-reveal mx-auto mt-5 max-w-xl text-lg leading-relaxed text-landing-cream/55">
            Need help with TeamNetwork? Email our support team and we&apos;ll get back to you within
            one business day.
          </p>

          <div className="scroll-reveal mt-10 flex flex-col items-center gap-4">
            <ButtonLink
              href={`mailto:${SUPPORT_EMAIL}?subject=TeamNetwork%20Support%20Request`}
              variant="landingPrimary"
              size="xl"
            >
              Email Support
            </ButtonLink>
            <p className="text-sm text-landing-cream/40">{SUPPORT_EMAIL}</p>

            <Link
              href="/"
              className="group mt-2 inline-flex items-center gap-2 text-base text-landing-cream/55 transition-colors hover:text-landing-cream"
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
              <span>Back to home</span>
            </Link>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
