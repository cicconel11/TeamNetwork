import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui";
import { FEATURES, FAQ_ITEMS } from "@/lib/pricing";
import { PricingSection } from "@/components/marketing/PricingSection";
import { FeatureIcon, FeatureCardIcon, TermsIcon } from "@/components/marketing/icons";
import "./landing-styles.css";

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

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/app");
  }

  return (
    <div id="top" className="landing-page min-h-screen text-landing-cream relative noise-overlay bg-landing-navy">
      <LandingAnimations />

      {/* Diagonal stripe background */}
      <div className="fixed inset-0 stripe-pattern pointer-events-none" />

      {/* Subtle depth gradient */}
      <div className="fixed inset-0 bg-gradient-to-b from-landing-navy via-landing-navy to-landing-navy/95 pointer-events-none" />

      {/* Header */}
      <LandingHeader />

      {/* Hero - "The Emergence" */}
      <section className="relative z-10 pt-12 lg:pt-20 pb-20 px-6">
        {/* Stadium Light Beams */}
        <StadiumLightBeams />

        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left - Copy */}
            <div>
              <div className="hero-animate inline-flex items-center gap-2 px-4 py-2 rounded-full bg-landing-cream/10 border border-landing-cream/20 mb-4">
                <span className="w-2 h-2 rounded-full bg-landing-green gold-shimmer" />
                <span className="text-landing-cream/80 text-sm font-medium">Built for organizations that go the distance</span>
              </div>

              <h1 className="hero-animate mb-6">
                <span className="sr-only">TeamNetwork: The platform that keeps your organization connected, past and present</span>
                <Image
                  src="/TeamNetwor.png"
                  alt=""
                  width={541}
                  height={303}
                  className="w-[300px] sm:w-[360px] lg:w-[420px] h-auto drop-shadow-[0_0_40px_rgba(34,197,94,0.15)]"
                  aria-hidden="true"
                  priority
                />
              </h1>

              <p className="hero-animate text-xl text-landing-cream/70 max-w-lg mb-10 leading-relaxed">
                Member directories, events, donations, philanthropy, and records — all in one place. Built for sports teams, Greek life, clubs, and organizations of all kinds.
              </p>

              <div className="hero-animate flex flex-col sm:flex-row gap-4">
                <ButtonLink href="/auth/signup" variant="custom" size="lg" className="bg-landing-green-dark hover:bg-[#15803d] text-white font-semibold px-8 py-6 text-base cta-glow">
                  Create Your Organization
                </ButtonLink>
                <ButtonLink href="/auth/login?redirect=/app/join" size="lg" variant="custom" className="bg-landing-cream/10 text-landing-cream hover:bg-landing-cream/20 border border-landing-cream/20 px-8 py-6 text-base">
                  Join an Organization
                </ButtonLink>
              </div>

              {/* Already a member */}
              <div className="hero-animate mt-6">
                <Link href="/auth/login" className="text-landing-cream/50 hover:text-landing-cream/70 transition-colors text-sm">
                  Already a member? <span className="underline underline-offset-2">Sign in</span>
                </Link>
              </div>
            </div>

            {/* Right - Example Organization (Scoreboard Preview) */}
            <div className="hero-animate relative">
              {/* Mock organization card with scoreboard styling */}
              <div className="bg-landing-navy-light/80 rounded-2xl border border-landing-cream/10 overflow-hidden">
                {/* Org header */}
                <div className="bg-landing-cream/5 border-b border-landing-cream/10 p-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-landing-cream/20 flex items-center justify-center border border-landing-cream/20">
                      <span className="font-display font-bold text-landing-cream text-lg">SR</span>
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-xl text-landing-cream">South Rock Ridge High School</h3>
                      <p className="text-sm text-landing-cream/50">Central Pennsylvania</p>
                    </div>
                  </div>
                </div>
                {/* Quick stats - Scoreboard style */}
                <div className="grid grid-cols-3 divide-x divide-landing-cream/10 border-b border-landing-cream/10 bg-[#0a0a0a]">
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold font-mono text-landing-green" style={{ textShadow: "0 0 10px rgba(34,197,94,0.5)" }}>127</p>
                    <p className="text-xs text-landing-cream/50 uppercase tracking-wider">Members</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold font-mono text-landing-green" style={{ textShadow: "0 0 10px rgba(34,197,94,0.5)" }}>24</p>
                    <p className="text-xs text-landing-cream/50 uppercase tracking-wider">Events</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold font-mono text-landing-green" style={{ textShadow: "0 0 10px rgba(34,197,94,0.5)" }}>$8.2k</p>
                    <p className="text-xs text-landing-cream/50 uppercase tracking-wider">Donations</p>
                  </div>
                </div>
                {/* Feature preview */}
                <div className="p-5 space-y-3">
                  {[
                    { icon: "users", label: "Member Directory", value: "48 active \u2022 79 alumni" },
                    { icon: "calendar", label: "Upcoming", value: "Spring Regatta - Mar 15" },
                    { icon: "trophy", label: "Recent Award", value: "Conference Champions 2025" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3 p-3 rounded-lg bg-landing-navy/50">
                      <div className="w-8 h-8 rounded-lg bg-landing-cream/10 flex items-center justify-center">
                        <FeatureCardIcon type={item.icon} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-landing-cream/50">{item.label}</p>
                        <p className="text-sm text-landing-cream truncate">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
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

      {/* Organization types ribbon - Championship Banners */}
      <section className="relative z-10 py-12 overflow-hidden border-y border-landing-cream/10 bg-landing-navy-light/50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex flex-wrap items-stretch justify-center gap-4 md:gap-6">
            {["Sports Teams", "Greek Life", "Clubs", "Volunteer Orgs", "Alumni Groups"].map((type, i) => (
              <div
                key={type}
                className="banner px-6 py-4 text-center min-w-[140px]"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <span className="text-landing-cream/70 text-sm uppercase tracking-[0.15em] font-medium whitespace-nowrap">
                  {type}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - "The Playbook" (moved before Features) */}
      <section className="relative z-10 py-24 px-6">
        <div className="chalkboard max-w-5xl mx-auto rounded-2xl p-8 sm:p-12">
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

      {/* Features - "Trophy Case" */}
      <section id="features" className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="scroll-reveal inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6">
              Features
            </div>
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold mb-6">
              Everything Your
              <br />
              <span className="text-landing-cream">Organization Needs</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/60 max-w-xl mx-auto text-lg">
              From daily operations to alumni engagement, we&apos;ve got you covered.
            </p>
          </div>

          <div className="features-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature, i) => (
              <div
                key={feature.title}
                className="trophy-card bg-landing-navy-light/50 backdrop-blur-sm rounded-2xl p-6 overflow-hidden"
              >
                {/* Trophy watermark */}
                <svg className="trophy-watermark" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                </svg>

                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-landing-cream/10 to-landing-cream/5 flex items-center justify-center mb-5">
                  <FeatureIcon index={i} />
                </div>
                <h3 className="font-display font-semibold text-lg text-landing-cream mb-2">{feature.title}</h3>
                <p className="text-sm text-landing-cream/50 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* Our Commitment (formerly Terms Summary) — reassurance after price */}
      <section id="terms-summary" className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="scroll-reveal font-display text-3xl sm:text-4xl font-bold mb-4">Our Commitment</h2>
            <p className="scroll-reveal text-landing-cream/60">
              Transparency matters. Here are the key points of our terms of service.
            </p>
          </div>

          <div className="terms-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {[
              { title: "Eligibility", text: "Must be 16+ to use the service." },
              { title: "Security", text: "You\u2019re responsible for your credentials." },
              { title: "Conduct", text: "No illegal, harmful, or infringing content." },
              { title: "Payments", text: "Fees are non-refundable unless required by law." },
              { title: "Data & IP", text: "We retain software rights; you retain content rights." },
              { title: "Disputes", text: "Resolved via binding arbitration in New York." },
            ].map((item, i) => (
              <div key={item.title} className="terms-card bg-landing-navy-light/50 rounded-xl p-5 border border-landing-cream/10">
                <div className="w-10 h-10 rounded-lg bg-landing-cream/10 flex items-center justify-center mb-3">
                  <TermsIcon index={i} />
                </div>
                <h4 className="font-display font-semibold text-landing-cream mb-1">{item.title}</h4>
                <p className="text-sm text-landing-cream/50">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link href="/terms" className="inline-flex items-center gap-2 text-landing-cream/60 hover:text-landing-cream transition-colors">
              <span>Read Full Terms</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ - "Press Conference" */}
      <section id="faq" className="relative z-10 py-24 px-6 bg-landing-navy-light/30">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold">
              Press <span className="text-landing-cream">Conference</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/50 mt-4">Your questions, answered</p>
          </div>

          <div className="space-y-4">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.question}
                className="scroll-reveal group bg-landing-navy-light/50 rounded-xl border border-landing-cream/10 overflow-hidden"
              >
                <summary className="px-6 py-5 cursor-pointer list-none flex items-center gap-3 text-landing-cream font-medium hover:bg-landing-cream/5 transition-colors">
                  {/* Microphone icon */}
                  <svg className="mic-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                  <span className="flex-1">{item.question}</span>
                  <svg
                    className="w-5 h-5 text-landing-cream/60 group-open:rotate-180 transition-transform duration-300 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-6 pb-5 text-landing-cream/60 leading-relaxed pl-12">{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

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
              alt="TeamNetwork"
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
            Free to get started. No credit card required.
          </p>

          <div className="scroll-reveal flex flex-col sm:flex-row gap-4 justify-center">
            <ButtonLink href="/auth/signup" variant="custom" size="lg" className="bg-landing-green-dark hover:bg-[#15803d] text-white font-semibold px-10 py-6 text-lg cta-glow">
              Create Your Organization
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-landing-cream/10 py-12 bg-landing-navy">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center">
              <Image src="/TeamNetwor.png" alt="TeamNetwork" width={541} height={303} sizes="32px" className="h-8 w-auto object-contain" />
            </div>

            <div className="flex items-center gap-8 text-sm text-landing-cream/50">
              <Link href="/terms" className="hover:text-landing-cream transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-landing-cream transition-colors">Privacy</Link>
              <Link href="#pricing" className="hover:text-landing-cream transition-colors">Pricing</Link>
              <a href="mailto:support@myteamnetwork.com" className="hover:text-landing-cream transition-colors">Contact</a>
            </div>

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
