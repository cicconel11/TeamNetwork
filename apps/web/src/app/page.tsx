import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui";
import { FAQ_ITEMS } from "@/lib/pricing";
import { PricingSection } from "@/components/marketing/PricingSection";
import { Hero } from "@/components/marketing/Hero";
import { Container } from "@/components/marketing/Container";
import { Section, SectionEyebrow } from "@/components/marketing/Section";
import {
  BackToTop,
  FAQAccordion,
  FeatureShowcase,
  LandingAnimations,
  LandingHeader,
} from "@/components/marketing/LandingClientComponents";
import { BackgroundMesh } from "@/components/marketing/BackgroundMesh";
import { NetworkConstellation } from "@/components/marketing/NetworkConstellation";
import {
  HERO_PROOF_POINTS,
  MARQUEE_ORG_TYPES,
  PLAYBOOK_STEPS,
  RULEBOOK_ITEMS,
} from "@/lib/landing-content";
import "./landing-styles.css";

export const metadata: Metadata = {
  title: "TeamNetwork — The Platform for Connected Organizations",
  description:
    "Build your network with member directories, events, contributions, team funding, and records — all in one place for clubs, organizations, sports teams, and more.",
  openGraph: {
    title: "TeamNetwork — The Platform for Connected Organizations",
    description:
      "Build your network with member directories, events, contributions, team funding, and records — all in one place for clubs, organizations, sports teams, and more.",
    url: "https://myteamnetwork.com",
    siteName: "TeamNetwork",
    images: [{ url: "https://myteamnetwork.com/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TeamNetwork — The Platform for Connected Organizations",
    description:
      "Build your network with member directories, events, contributions, team funding, and records — all in one place for clubs, organizations, sports teams, and more.",
    images: ["https://myteamnetwork.com/og-image.png"],
  },
};

export default async function LandingPage() {
  // Fast path: no Supabase auth cookie → skip JWT validate. Middleware's
  // public-route fast path already handles the network hop; this avoids
  // re-paying the same cost inside the server component.
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some((c) => /^sb-.*-auth-token/.test(c.name));

  if (hasAuthCookie) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      redirect("/app");
    }
  }

  return (
    <div id="top" className="landing-page relative min-h-screen overflow-x-clip bg-landing-navy text-landing-cream">
      <LandingAnimations />

      {/* Pronounced animated gradient mesh — sits behind everything (-z-20) */}
      <BackgroundMesh />

      {/* Network constellation — drifting nodes + proximity edges, parallax (-z-10) */}
      <NetworkConstellation />

      {/* Soft ambient glow at the top, layered over the mesh */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(34,197,94,0.10),transparent_70%)]"
      />

      {/* Header */}
      <LandingHeader />

      {/* Hero - "The Emergence" */}
      <Hero proofPoints={HERO_PROOF_POINTS} />

      {/* Organization types ribbon — quiet small-caps marquee, no boxes */}
      <Section tone="tint" divider="both" padY="sm" className="overflow-hidden">
        <p className="mb-8 text-center text-xs uppercase tracking-[0.24em] text-landing-cream/35">
          One platform for every kind of community
        </p>
        <div className="marquee-container overflow-hidden [-webkit-mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)] [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <div className="marquee-track" aria-label="Organization types we serve">
            {[...Array(2)].map((_, setIndex) => (
              <div
                key={setIndex}
                className="flex items-center gap-10 px-5 md:gap-14"
                aria-hidden={setIndex > 0}
              >
                {MARQUEE_ORG_TYPES.map((type) => (
                  <span
                    key={`${setIndex}-${type}`}
                    className="flex-shrink-0 whitespace-nowrap text-lg font-medium text-landing-cream/45 sm:text-xl"
                  >
                    {type}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* How it works — open, numbered, no box */}
      <Section padY="lg">
        <Container size="lg">
          <div className="mb-16 max-w-2xl">
            <SectionEyebrow>How it works</SectionEyebrow>
            <h2 className="scroll-reveal display-section text-landing-cream">
              From kickoff to <span className="accent-italic">connected.</span>
            </h2>
            <p className="scroll-reveal mt-5 text-lg leading-relaxed text-landing-cream/55">
              Your game plan to get started — three steps, no playbook required.
            </p>
          </div>

          <div className="grid gap-x-16 gap-y-12 md:grid-cols-3">
            {PLAYBOOK_STEPS.map((item) => (
              <div key={item.step} className="scroll-reveal">
                <div className="hairline-flat mb-6" />
                <span className="block font-display text-5xl font-bold leading-none text-landing-green/80">
                  {String(item.step).padStart(2, "0")}
                </span>
                <h3 className="mt-6 font-display text-xl font-semibold text-landing-cream">
                  {item.title}
                </h3>
                <p className="mt-3 max-w-[34ch] text-base leading-relaxed text-landing-cream/55">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Features — big centered hero windows, one per chapter */}
      <Section id="features" tone="tint" divider="top" padY="lg">
        <Container size="xl">
          <div className="mb-16 max-w-2xl">
            <SectionEyebrow>Features</SectionEyebrow>
            <h2 className="scroll-reveal display-section text-landing-cream">
              Everything your roster <span className="accent-italic">needs.</span>
            </h2>
            <p className="scroll-reveal mt-5 text-lg leading-relaxed text-landing-cream/55">
              Expand your network, coordinate team events, and keep every member, alumni, and
              supporter connected — in one place.
            </p>
          </div>
        </Container>

        {/* Breaks out wider than the text column — the media is the main event */}
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <FeatureShowcase />
        </div>
      </Section>

      <div className="hairline" />

      {/* Pricing */}
      <PricingSection />

      {/* Terms — open commitments, no box */}
      <Section id="terms-summary" divider="top" padY="lg">
        <Container size="md">
          <div className="mb-14 max-w-2xl">
            <SectionEyebrow>Terms</SectionEyebrow>
            <h2 className="scroll-reveal display-section text-landing-cream">
              Transparency, <span className="accent-italic">by default.</span>
            </h2>
            <p className="scroll-reveal mt-5 text-lg leading-relaxed text-landing-cream/55">
              No fine-print games. Here are the key points up front.
            </p>
          </div>

          <ul className="scroll-reveal border-t border-white/10">
            {RULEBOOK_ITEMS.map((item, i) => (
              <li key={item.title} className="flex items-start gap-6 border-b border-white/10 py-5">
                <span className="w-8 flex-shrink-0 font-display text-2xl font-bold leading-none text-landing-green/70">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <span className="font-display text-base font-semibold text-landing-cream">
                    {item.title}
                  </span>
                  <span className="text-base text-landing-cream/55"> — {item.text}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-10">
            <Link
              href="/terms"
              className="group inline-flex items-center gap-2 text-base text-landing-cream/60 transition-colors hover:text-landing-cream"
            >
              <span>Read full terms</span>
              <svg
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </Container>
      </Section>

      {/* FAQ — clean hairline accordion */}
      <Section id="faq" tone="tint" divider="top" padY="lg">
        <Container size="sm">
          <div className="mb-14 max-w-2xl">
            <SectionEyebrow>FAQ</SectionEyebrow>
            <h2 className="scroll-reveal display-section text-landing-cream">
              Questions, <span className="accent-italic">answered.</span>
            </h2>
          </div>

          <FAQAccordion items={FAQ_ITEMS} />
        </Container>
      </Section>

      {/* Final CTA — calm, type-led */}
      <Section divider="top" padY="lg" className="overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-landing-green/10 blur-[140px]" />
        </div>

        <Container size="md" className="text-center">
          <div className="scroll-reveal mb-10 inline-block">
            <Image
              src="/TeamNetwork.png"
              alt=""
              aria-hidden="true"
              width={400}
              height={224}
              sizes="(min-width: 1024px) 176px, (min-width: 640px) 144px, 120px"
              className="mx-auto h-28 w-auto object-contain sm:h-36 lg:h-44"
              priority={false}
            />
          </div>

          <h2 className="scroll-reveal display-hero mx-auto mb-7 max-w-[16ch] text-landing-cream">
            Your community, <span className="accent-italic">connected for good.</span>
          </h2>

          <p className="scroll-reveal mx-auto mb-3 max-w-2xl text-xl leading-relaxed text-landing-cream/60">
            Join today to create new opportunities for your organization and members.
          </p>

          <p className="scroll-reveal mb-9 text-sm text-landing-cream/40">
            Contact us for contract pricing tailored to your organization.
          </p>

          <div className="scroll-reveal flex justify-center">
            <ButtonLink href="/contact" variant="landingPrimary" size="xl">
              Request Pricing
            </ButtonLink>
          </div>
        </Container>
      </Section>

      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      {/* Footer */}
      <footer className="relative z-10 py-16 bg-landing-navy">
        <Container size="xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <Image src="/TeamNetwork.png" alt="TeamNetwork" width={541} height={303} sizes="32px" className="h-8 w-auto object-contain" />
              </div>
              <p className="text-sm text-landing-cream/55 leading-relaxed">
                The platform that keeps your organization connected, past and present.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">Product</p>
                <nav className="flex flex-col gap-2 text-sm">
                  <Link href="#features" className="text-landing-cream/65 hover:text-landing-cream transition-colors">Features</Link>
                  <Link href="#pricing" className="text-landing-cream/65 hover:text-landing-cream transition-colors">Pricing</Link>
                  <Link href="/demos" className="text-landing-cream/65 hover:text-landing-cream transition-colors">Demos</Link>
                  <Link href="/contact" className="text-landing-cream/65 hover:text-landing-cream transition-colors">Contact sales</Link>
                </nav>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">Legal</p>
                <nav className="flex flex-col gap-2 text-sm">
                  <Link href="/terms" className="text-landing-cream/65 hover:text-landing-cream transition-colors">Terms</Link>
                  <Link href="/privacy" className="text-landing-cream/65 hover:text-landing-cream transition-colors">Privacy</Link>
                  <Link href="/support" className="text-landing-cream/65 hover:text-landing-cream transition-colors">Support</Link>
                </nav>
              </div>
            </div>

            <div className="md:text-right">
              <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">Contact</p>
              <a href="mailto:mleonard@myteamnetwork.com" className="text-sm text-landing-cream/65 hover:text-landing-cream transition-colors">
                mleonard@myteamnetwork.com
              </a>
              <p className="mt-6 text-sm text-landing-cream/45 italic">
                Built for teams that go the distance.
              </p>
            </div>
          </div>

          <div className="mt-10 pt-6 text-center">
            <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent mb-6" />
            <p className="text-sm text-landing-cream/45">
              &copy; {new Date().getFullYear()} TeamNetwork
            </p>
          </div>
        </Container>
      </footer>

      {/* Back to top — scroll-aware */}
      <BackToTop />
    </div>
  );
}
