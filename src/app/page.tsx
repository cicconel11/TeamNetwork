import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui";
import { FAQ_ITEMS } from "@/lib/pricing";
import { PricingSection } from "@/components/marketing/PricingSection";
import "./landing-styles.css";

export const metadata: Metadata = {
  title: "TeamNetwork — The Platform for Connected Organizations",
  description:
    "Build your network with member directories, events, donations, philanthropy, and records — all in one place for clubs, organizations, sports teams, and more.",
  openGraph: {
    title: "TeamNetwork — The Platform for Connected Organizations",
    description:
      "Build your network with member directories, events, donations, philanthropy, and records — all in one place for clubs, organizations, sports teams, and more.",
    url: "https://myteamnetwork.com",
    siteName: "TeamNetwork",
    images: [{ url: "https://myteamnetwork.com/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TeamNetwork — The Platform for Connected Organizations",
    description:
      "Build your network with member directories, events, donations, philanthropy, and records — all in one place for clubs, organizations, sports teams, and more.",
    images: ["https://myteamnetwork.com/og-image.png"],
  },
};

const FAQAccordion = dynamic(
  () => import("@/components/marketing/FAQAccordion").then((mod) => mod.FAQAccordion),
  { ssr: false }
);

const HeroOrgCard = dynamic(
  () => import("@/components/marketing/HeroOrgCard").then((mod) => mod.HeroOrgCard),
  { ssr: false }
);

// Lazy-load animation components - only needed on landing page
const LandingAnimations = dynamic(
  () => import("@/components/marketing/LandingAnimations").then((mod) => mod.LandingAnimations),
  { ssr: false }
);

const StadiumLightBeams = dynamic(
  () => import("@/components/marketing/StadiumLightBeams").then((mod) => mod.StadiumLightBeams),
  { ssr: false }
);

const Confetti = dynamic(
  () => import("@/components/marketing/Confetti").then((mod) => mod.Confetti),
  { ssr: false }
);

const LandingHeader = dynamic(
  () => import("@/components/marketing/LandingHeader").then((mod) => mod.LandingHeader),
  { ssr: false }
);

const BackToTop = dynamic(
  () => import("@/components/marketing/BackToTop").then((mod) => mod.BackToTop),
  { ssr: false }
);

const BackgroundPaths = dynamic(
  () => import("@/components/marketing/BackgroundPaths").then((mod) => mod.BackgroundPaths),
  { ssr: false }
);

const FeaturesGrid = dynamic(
  () => import("@/components/marketing/FeaturesGrid").then((mod) => mod.FeaturesGrid),
  { ssr: false }
);

const HERO_PROOF_POINTS = [
  { value: "10 min", label: "to launch an organization" },
  { value: "1 code", label: "for member onboarding" },
  { value: "24/7", label: "community history online" },
] as const;

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/app");
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
      <section className="landing-hero-stage relative z-10 overflow-hidden px-4 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-12 lg:px-6 lg:pb-16 lg:pt-10">
        {/* Animated paths — atmospheric background */}
        <BackgroundPaths />

        {/* Stadium Light Beams */}
        <StadiumLightBeams />

        <div className="relative z-10 mx-auto max-w-6xl">
          <div className="grid min-w-0 grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
            {/* Left - Copy (centered on mobile/tablet, left-aligned on desktop) */}
            <div className="w-full min-w-0 max-w-full text-center lg:text-left">
              <div className="hero-animate mb-4 flex justify-center lg:justify-start">
                <div className="inline-flex max-w-full items-center justify-center gap-2 rounded-full border border-landing-green/30 bg-landing-green/10 px-3 py-2 shadow-[0_0_40px_rgba(34,197,94,0.12)] sm:px-4">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-landing-green gold-shimmer" />
                  <span className="min-w-0 text-balance text-center text-sm font-medium leading-snug text-landing-cream/80">
                    Build your network, wherever your community starts
                  </span>
                </div>
              </div>

              <h1 className="hero-animate mb-3 flex justify-center lg:justify-start">
                <span className="sr-only">TeamNetwork: The platform that keeps your organization connected, past and present</span>
                <Image
                  src="/TeamNetwor.png"
                  alt=""
                  width={541}
                  height={303}
                  className="h-auto w-[min(100%,260px)] drop-shadow-[0_0_40px_rgba(34,197,94,0.15)] sm:w-[320px] lg:w-[340px]"
                  aria-hidden="true"
                  priority
                />
              </h1>

              <p className="hero-animate mx-auto mb-3 max-w-[12ch] text-center text-2xl font-semibold tracking-tight text-landing-cream sm:max-w-none sm:text-3xl lg:mx-0 lg:text-left lg:text-4xl">
                Build your network.<br className="hidden sm:block" /> Keep it connected.
              </p>

              <p className="hero-animate mx-auto mb-8 max-w-[32ch] text-base leading-relaxed text-landing-cream/80 sm:max-w-xl sm:text-lg lg:mx-0 lg:mb-6">
                Bring together current members, alumni, supporters, and families in one place. Built for{" "}
                <span className="font-medium text-landing-cream">clubs</span>,{" "}
                <span className="font-medium text-landing-cream">organizations</span>,{" "}
                <span className="font-medium text-landing-cream">sports teams</span>, and communities of all kinds.
              </p>

              <div className="hero-animate mx-0 flex w-full max-w-full flex-col items-stretch gap-4 sm:mx-auto sm:flex-row sm:justify-center lg:mx-0 lg:justify-start">
                <ButtonLink href="/auth/signup" variant="custom" size="lg" className="landing-primary-cta cta-glow w-full min-w-0 max-w-full whitespace-normal bg-landing-green-dark px-5 py-4 text-center text-base font-semibold leading-tight text-white hover:bg-[#15803d] sm:w-auto sm:px-8 sm:py-5">
                  Create Your Organization
                </ButtonLink>
                <ButtonLink href="/auth/login?redirect=/app/join" size="lg" variant="custom" className="landing-secondary-cta w-full min-w-0 max-w-full whitespace-normal border border-landing-cream/20 bg-landing-cream/10 px-5 py-4 text-center text-base leading-tight text-landing-cream hover:bg-landing-cream/20 sm:w-auto sm:px-8 sm:py-5">
                  Join an Organization
                </ButtonLink>
              </div>

              {/* Already a member */}
              <div className="hero-animate mt-4">
                <Link href="/auth/login" className="text-sm text-landing-cream/50 transition-colors hover:text-landing-cream/70">
                  Already a member? <span className="underline underline-offset-2">Sign in</span>
                </Link>
              </div>

              <div className="hero-animate mx-auto mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3 lg:mx-0">
                {HERO_PROOF_POINTS.map((point) => (
                  <div key={point.value} className="landing-proof-tile rounded-xl border border-landing-cream/10 bg-landing-cream/[0.04] p-4 text-left">
                    <p className="font-display text-2xl font-bold leading-none text-landing-green">
                      {point.value}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-landing-cream/55">
                      {point.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right - Example Organization (Scoreboard Preview) */}
            <HeroOrgCard />
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden lg:block">
          <div className="scroll-indicator flex flex-col items-center gap-2 text-landing-cream/30">
            <span className="text-xs uppercase tracking-widest">Scroll</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        </div>
      </section>

      {/* Organization types ribbon — infinite scrolling marquee */}
      <section className="relative z-10 py-12 overflow-hidden border-y border-landing-cream/10 bg-landing-navy-light/50">
        <div className="marquee-container overflow-hidden">
          <div className="marquee-track" aria-label="Organization types we serve">
            {/* Duplicate list for seamless loop */}
            {[...Array(2)].map((_, setIndex) => (
              <div key={setIndex} className="flex items-stretch gap-4 md:gap-6 px-2 md:px-3" aria-hidden={setIndex > 0}>
                {["Sports Teams", "Greek Life", "Clubs", "Volunteer Orgs", "Alumni Groups", "Honor Societies", "Booster Clubs", "Student Government"].map((type) => (
                  <div
                    key={`${setIndex}-${type}`}
                    className="banner px-6 py-4 text-center min-w-[140px] flex-shrink-0"
                  >
                    <span className="text-landing-cream/70 text-sm uppercase tracking-[0.15em] font-medium whitespace-nowrap">
                      {type}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - "The Playbook" (moved before Features) */}
      <section className="relative z-10 px-5 py-20 sm:px-6 sm:py-24">
        <div className="chalkboard mx-auto max-w-5xl rounded-2xl p-6 sm:p-10 md:p-12">
          <div className="text-center mb-16">
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold">
              The <span className="text-landing-cream">Playbook</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/50 mt-4">Your game plan to get started</p>
          </div>

          {/* Desktop: horizontal layout with play-route connectors */}
          <div className="hidden md:grid md:grid-cols-3 gap-8 relative">
            {/* Connection line - play route */}
            <div className="absolute top-[1.75rem] left-[calc(16.67%+1.75rem)] right-[calc(16.67%+1.75rem)]">
              <div className="play-route w-full" />
            </div>

            {[
              { step: "1", title: "Create your org", desc: "Sign up and customize your team\u2019s profile, colors, and settings." },
              { step: "2", title: "Invite members", desc: "Share your unique invite code or send email invitations." },
              { step: "3", title: "Build your legacy", desc: "Track events, manage donations, and connect generations." },
            ].map((item) => (
              <div key={item.step} className="scroll-reveal text-center relative">
                <div className="play-marker mx-auto mb-6 relative z-10">
                  <span className="font-display font-bold text-xl text-landing-cream">{item.step}</span>
                </div>
                <h3 className="font-display font-semibold text-xl text-landing-cream mb-3">{item.title}</h3>
                <p className="text-landing-cream/50 text-sm leading-relaxed max-w-xs mx-auto">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Mobile: vertical timeline */}
          <div className="md:hidden mobile-timeline space-y-10">
            {[
              { step: "1", title: "Create your org", desc: "Sign up and customize your team\u2019s profile, colors, and settings." },
              { step: "2", title: "Invite members", desc: "Share your unique invite code or send email invitations." },
              { step: "3", title: "Build your legacy", desc: "Track events, manage donations, and connect generations." },
            ].map((item) => (
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
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      {/* Features - "Trophy Case" */}
      <section id="features" className="relative z-10 py-24 px-6 bg-landing-navy-light/20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="scroll-reveal inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6">
              Features
            </div>
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold mb-6">
              Build Your
              <br />
              <span className="text-landing-cream">Community Network</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/60 max-w-xl mx-auto text-lg">
              Expand your network, coordinate team events, and keep every member, alumni, and supporter connected.
            </p>
          </div>

          <FeaturesGrid />
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      {/* Pricing */}
      <PricingSection />

      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      {/* Our Commitment — "The Rulebook" */}
      <section id="terms-summary" className="relative z-10 py-24 px-6">
        <div className="chalkboard max-w-4xl mx-auto rounded-2xl p-8 sm:p-12">
          <div className="text-center mb-12">
            <div className="scroll-reveal inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6">
              Terms
            </div>
            <h2 className="scroll-reveal font-display text-3xl sm:text-4xl font-bold mb-4">
              The <span className="text-landing-cream">Rulebook</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/50">
              Transparency matters. Here are the key points.
            </p>
          </div>

          <div className="scroll-reveal grid sm:grid-cols-2 gap-x-10 gap-y-0 mb-10">
            {[
              { title: "Eligibility", text: "Must be 16+ to use the service." },
              { title: "Security", text: "You\u2019re responsible for your credentials." },
              { title: "Conduct", text: "No illegal, harmful, or infringing content." },
              { title: "Payments", text: "Fees are non-refundable unless required by law." },
              { title: "Data & IP", text: "We retain software rights; you retain content rights." },
              { title: "Disputes", text: "Resolved via binding arbitration in New York." },
            ].map((item, i) => (
              <div key={item.title} className="flex items-start gap-4 py-4 border-b border-landing-cream/10 last:border-b-0">
                <span className="font-display font-bold text-landing-green/60 text-lg leading-none mt-0.5 flex-shrink-0 w-6 text-right">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <span className="font-display font-semibold text-landing-cream text-sm">{item.title}</span>
                  <span className="text-landing-cream/50 text-sm"> — {item.text}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link href="/terms" className="inline-flex items-center gap-2 text-landing-cream/60 hover:text-landing-cream transition-colors group">
              <span>Read Full Terms</span>
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      {/* FAQ - "Press Conference" */}
      <section id="faq" className="relative z-10 py-24 px-6 bg-landing-navy-light/20">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold">
              Press <span className="text-landing-cream">Conference</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/50 mt-4">Your questions, answered</p>
          </div>

          <FAQAccordion items={FAQ_ITEMS} />
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-landing-cream/10 to-transparent" />

      {/* Final CTA - "Championship Moment" */}
      <section className="relative z-10 py-24 px-6 overflow-hidden">
        {/* Confetti burst */}
        <Confetti />

        {/* Background glow */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none -z-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-landing-green/10 blur-[100px]" />
        </div>

        <div className="max-w-4xl mx-auto text-center">
          {/* Logo */}
          <div className="scroll-reveal inline-block mb-8">
            <Image
              src="/TeamNetwor.png"
              alt=""
              aria-hidden="true"
              width={541}
              height={303}
              className="h-32 sm:h-40 lg:h-48 w-auto object-contain mx-auto drop-shadow-[0_0_60px_rgba(34,197,94,0.2)]"
              priority={false}
            />
          </div>

          <h2 className="scroll-reveal font-display text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 jersey-text">
            Your Community,
            <br />
            <span className="text-landing-green">Connected For Good</span>
          </h2>

          <p className="scroll-reveal text-xl text-landing-cream/60 mb-4 max-w-2xl mx-auto">
            Join today to create new opportunities for your organization and members.
          </p>

          <p className="scroll-reveal text-sm text-landing-cream/40 mb-10">
            Start with a free trial. Credit card required.
          </p>

          <div className="scroll-reveal flex flex-col sm:flex-row gap-4 justify-center">
            <ButtonLink href="/auth/signup" variant="custom" size="lg" className="bg-landing-green-dark hover:bg-[#15803d] text-white font-semibold px-10 py-6 text-lg cta-glow">
              Create Your Organization
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-landing-cream/10 py-16 bg-landing-navy">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
            {/* Left — Brand */}
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <Image src="/TeamNetwor.png" alt="TeamNetwork" width={541} height={303} sizes="32px" className="h-8 w-auto object-contain" />
              </div>
              <p className="text-sm text-landing-cream/40 leading-relaxed">
                The platform that keeps your organization connected, past and present.
              </p>
            </div>

            {/* Center — Links */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">Product</p>
                <nav className="flex flex-col gap-2 text-sm">
                  <Link href="#features" className="text-landing-cream/50 hover:text-landing-cream transition-colors">Features</Link>
                  <Link href="#pricing" className="text-landing-cream/50 hover:text-landing-cream transition-colors">Pricing</Link>
                  <Link href="/demos" className="text-landing-cream/50 hover:text-landing-cream transition-colors">Demos</Link>
                  <Link href="/pricing/calculator" className="text-landing-cream/50 hover:text-landing-cream transition-colors">Pricing calculator</Link>
                </nav>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">Legal</p>
                <nav className="flex flex-col gap-2 text-sm">
                  <Link href="/terms" className="text-landing-cream/50 hover:text-landing-cream transition-colors">Terms</Link>
                  <Link href="/privacy" className="text-landing-cream/50 hover:text-landing-cream transition-colors">Privacy</Link>
                </nav>
              </div>
            </div>

            {/* Right — Contact */}
            <div className="md:text-right">
              <p className="text-xs uppercase tracking-[0.15em] text-landing-cream/30 font-medium mb-3">Contact</p>
              <a href="mailto:mleonard@myteamnetwork.com" className="text-sm text-landing-cream/50 hover:text-landing-cream transition-colors">
                mleonard@myteamnetwork.com
              </a>
              <p className="mt-6 text-sm text-landing-cream/30 italic">
                Built for teams that go the distance.
              </p>
            </div>
          </div>

          <div className="border-t border-landing-cream/10 mt-10 pt-6 text-center">
            <p className="text-sm text-landing-cream/30">
              &copy; {new Date().getFullYear()} TeamNetwork
            </p>
          </div>
        </div>
      </footer>

      {/* Back to top — scroll-aware */}
      <BackToTop />
    </div>
  );
}
