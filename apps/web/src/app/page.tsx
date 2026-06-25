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
  Confetti,
  FAQAccordion,
  FeaturesGrid,
  LandingAnimations,
  LandingHeader,
} from "@/components/marketing/LandingClientComponents";
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
    <div id="top" className="landing-page relative min-h-screen overflow-x-clip bg-landing-navy text-landing-cream noise-overlay">
      <LandingAnimations />

      {/* Diagonal stripe background */}
      <div className="fixed inset-0 stripe-pattern pointer-events-none" />

      {/* Subtle depth gradient */}
      <div className="fixed inset-0 bg-gradient-to-b from-landing-navy via-landing-navy to-landing-navy/95 pointer-events-none" />

      {/* Header */}
      <LandingHeader />

      {/* Hero - "The Emergence" */}
      <Hero proofPoints={HERO_PROOF_POINTS} />

      {/* Organization types ribbon — infinite scrolling marquee */}
      <Section tone="tint" divider="both" padY="sm" className="overflow-hidden">
        <div
          className="marquee-container overflow-hidden [-webkit-mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)] [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]"
        >
          <div className="marquee-track" aria-label="Organization types we serve">
            {[...Array(2)].map((_, setIndex) => (
              <div
                key={setIndex}
                className="flex items-stretch gap-6 md:gap-8 px-2 md:px-3"
                aria-hidden={setIndex > 0}
              >
                {MARQUEE_ORG_TYPES.map((type) => (
                  <div
                    key={`${setIndex}-${type}`}
                    className="banner px-6 py-4 text-center min-w-[140px] flex-shrink-0"
                  >
                    <span
                      className="text-landing-cream/70 text-sm font-medium whitespace-nowrap"
                      style={{ letterSpacing: "0.12em", fontVariantCaps: "all-small-caps" }}
                    >
                      {type}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* How It Works - "The Playbook" */}
      <Section padY="md">
        <Container size="lg">
          <div className="chalkboard rounded-2xl p-6 sm:p-10 md:p-12">
            <div className="text-center mb-16">
              <SectionEyebrow>How it works</SectionEyebrow>
              <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold">
                The <span className="text-landing-cream">Playbook</span>
              </h2>
              <p className="scroll-reveal text-landing-cream/50 mt-4">Your game plan to get started</p>
            </div>

            <div className="hidden md:grid md:grid-cols-3 gap-8 relative">
              <div className="absolute top-[1.75rem] inset-x-[calc((100%/3)/2)]">
                <div className="play-route w-full" />
              </div>

              {PLAYBOOK_STEPS.map((item) => (
                <div key={item.step} className="scroll-reveal text-center relative">
                  <div className="play-marker mx-auto mb-6 relative z-10">
                    <span className="font-display font-bold text-xl text-landing-cream">{item.step}</span>
                  </div>
                  <h3 className="font-display font-semibold text-xl text-landing-cream mb-3">{item.title}</h3>
                  <p className="text-landing-cream/50 text-sm leading-relaxed max-w-[26ch] mx-auto">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="md:hidden mobile-timeline space-y-10">
              {PLAYBOOK_STEPS.map((item) => (
                <div key={item.step} className="scroll-reveal relative">
                  <div className="play-marker mb-4">
                    <span className="font-display font-bold text-xl text-landing-cream">{item.step}</span>
                  </div>
                  <h3 className="font-display font-semibold text-xl text-landing-cream mb-2">{item.title}</h3>
                  <p className="text-landing-cream/50 text-sm leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* Features - "Trophy Case" */}
      <Section id="features" tone="tint" divider="top" padY="md">
        <Container size="xl">
          <div className="text-center mb-16">
            <SectionEyebrow>Features</SectionEyebrow>
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl lg:text-6xl font-bold mb-6">
              Build Your
              <br />
              <span className="text-landing-cream">Community Network</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/60 max-w-prose mx-auto text-lg">
              Expand your network, coordinate team events, and keep every member, alumni, and supporter connected.
            </p>
          </div>

          <FeaturesGrid />
        </Container>
      </Section>

      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      {/* Pricing */}
      <PricingSection />

      {/* Our Commitment — "The Rulebook" */}
      <Section id="terms-summary" divider="top" padY="md">
        <Container size="md">
          <div className="chalkboard rounded-2xl p-8 sm:p-12">
            <div className="text-center mb-12">
              <SectionEyebrow>Terms</SectionEyebrow>
              <h2 className="scroll-reveal font-display text-3xl sm:text-4xl font-bold mb-4">
                The <span className="text-landing-cream">Rulebook</span>
              </h2>
              <p className="scroll-reveal text-landing-cream/50">
                Transparency matters. Here are the key points.
              </p>
            </div>

            <ul className="scroll-reveal grid sm:grid-cols-2 gap-x-10 gap-y-3 mb-10 sm:[&>li:nth-child(odd):not(:nth-last-child(-n+2))]:border-b sm:[&>li:nth-child(even):not(:nth-last-child(-n+2))]:border-b [&>li:not(:last-child)]:border-b [&>li]:border-landing-cream/10">
              {RULEBOOK_ITEMS.map((item, i) => (
                <li key={item.title} className="flex items-start gap-4 py-3">
                  <span className="font-display text-xl text-landing-green/80 leading-none mt-0.5 flex-shrink-0 w-6 text-right">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <span className="font-display font-semibold text-landing-cream text-sm">{item.title}</span>
                    <span className="text-landing-cream/65 text-sm"> — {item.text}</span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="text-center">
              <Link
                href="/terms"
                className="inline-flex items-center gap-2 text-landing-cream/60 hover:text-landing-cream transition-colors group"
              >
                <span>Read Full Terms</span>
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </Container>
      </Section>

      {/* FAQ - "Press Conference" */}
      <Section id="faq" tone="tint" divider="top" padY="md">
        <Container size="sm">
          <div className="text-center mb-12">
            <SectionEyebrow>FAQ</SectionEyebrow>
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold">
              Press <span className="text-landing-cream">Conference</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/50 mt-4">Your questions, answered</p>
          </div>

          <FAQAccordion items={FAQ_ITEMS} />
        </Container>
      </Section>

      {/* Final CTA - "Championship Moment" */}
      <Section divider="top" padY="md" className="overflow-hidden">
        <Confetti />

        <div className="absolute top-0 left-0 w-full h-full pointer-events-none -z-10">
          <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-landing-green/10 blur-[120px]" />
        </div>

        <Container size="md" className="text-center">
          <div className="scroll-reveal inline-block mb-8">
            <Image
              src="/TeamNetwork.png"
              alt=""
              aria-hidden="true"
              width={400}
              height={224}
              sizes="(min-width: 1024px) 192px, (min-width: 640px) 160px, 128px"
              className="h-32 sm:h-40 lg:h-48 w-auto object-contain mx-auto drop-shadow-[0_0_60px_rgba(34,197,94,0.2)]"
              priority={false}
            />
          </div>

          <h2 className="scroll-reveal font-display text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 jersey-text">
            Your Community,
            <br />
            <span className="text-landing-green">Connected For Good</span>
          </h2>

          <p className="scroll-reveal text-xl text-landing-cream/60 mb-3 max-w-2xl mx-auto">
            Join today to create new opportunities for your organization and members.
          </p>

          <p className="scroll-reveal text-sm text-landing-cream/40 mb-8">
            Contact us for contract pricing tailored to your organization.
          </p>

          <div className="scroll-reveal flex flex-col sm:flex-row gap-4 justify-center">
            <ButtonLink href="/contact" variant="landingPrimary" size="xl" className="cta-glow">
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
