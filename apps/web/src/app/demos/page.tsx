import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/ui";
import { Container } from "@/components/marketing/Container";
import { Section, SectionEyebrow } from "@/components/marketing/Section";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import "../landing-styles.css";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Demo | TeamNetwork",
};

export default function DemosPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <Section padY="lg">
        <Container size="lg" className="text-center">
          <SectionEyebrow centered>Demo</SectionEyebrow>
          <h1 className="scroll-reveal display-hero text-landing-cream">
            See TeamNetwork <span className="accent-italic">in action.</span>
          </h1>
          <p className="scroll-reveal mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-landing-cream/55">
            Manage rosters, events, fundraising, and communication — all in one place built for
            teams.
          </p>
        </Container>
      </Section>

      {/* Screenshot */}
      <Section padY="sm">
        <Container size="lg">
          <div className="scroll-reveal overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/40">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-landing-cream/20" />
              <span className="h-3 w-3 rounded-full bg-landing-cream/20" />
              <span className="h-3 w-3 rounded-full bg-landing-cream/20" />
              <span className="ml-3 font-mono text-xs text-landing-cream/30">myteamnetwork.com</span>
            </div>
            <Image
              src="/app-screenshot.png"
              alt="TeamNetwork dashboard showing roster management, events, and team communication"
              width={1920}
              height={1080}
              className="h-auto w-full"
              priority
            />
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <Section divider="top" padY="lg">
        <Container size="md" className="text-center">
          <h2 className="scroll-reveal display-section text-landing-cream">
            Request a <span className="accent-italic">demo.</span>
          </h2>
          <p className="scroll-reveal mx-auto mt-5 max-w-xl text-lg leading-relaxed text-landing-cream/55">
            Want a personalized walkthrough? Reach out and we&apos;ll show you how TeamNetwork can
            work for your organization.
          </p>
          <div className="scroll-reveal mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <ButtonLink
              href="mailto:cicconel@myteamnetwork.com?subject=Demo%20Request"
              variant="landingPrimary"
              size="xl"
            >
              Request a Demo
            </ButtonLink>
            <ButtonLink href="/contact" variant="landingSecondary" size="xl">
              Contact Sales
            </ButtonLink>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
