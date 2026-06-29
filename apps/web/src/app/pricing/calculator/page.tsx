import { ButtonLink } from "@/components/ui";
import { Container } from "@/components/marketing/Container";
import { Section, SectionEyebrow } from "@/components/marketing/Section";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import "../../landing-styles.css";

export default function PricingCalculatorPage() {
  return (
    <MarketingShell>
      <Section padY="lg">
        <Container size="sm" className="text-center">
          <SectionEyebrow centered>Pricing</SectionEyebrow>
          <h1 className="scroll-reveal display-section text-landing-cream">
            Contact us for <span className="accent-italic">pricing.</span>
          </h1>
          <p className="scroll-reveal mx-auto mt-5 max-w-xl text-lg leading-relaxed text-landing-cream/55">
            We no longer publish a self-serve pricing calculator. TeamNetwork pricing is
            contract-based and tailored to your organization&apos;s size, modules, support needs, and
            rollout plan.
          </p>
          <div className="scroll-reveal mt-9 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/contact" variant="landingPrimary" size="xl">
              Contact sales
            </ButtonLink>
            <ButtonLink href="/#pricing" variant="landingSecondary" size="xl">
              Back to pricing
            </ButtonLink>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
