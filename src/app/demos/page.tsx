import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { LandingAnimations } from "@/components/marketing";
import "../landing-styles.css";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Demo | TeamNetwork",
};

export default function DemosPage() {
  return (
    <div id="top" className="landing-page min-h-screen text-landing-cream relative noise-overlay bg-landing-navy">
      <LandingAnimations />

      {/* Background */}
      <div className="fixed inset-0 stripe-pattern pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-landing-navy via-landing-navy to-landing-navy/95 pointer-events-none" />

      {/* Header */}
      <header className="relative z-20 sticky top-0 bg-landing-navy/95 backdrop-blur-md border-b border-landing-cream/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-2">
            <Image
              src="/TeamNetwor.png"
              alt=""
              width={541}
              height={303}
              sizes="28px"
              className="h-8 w-auto shrink-0 object-contain sm:h-7"
              aria-hidden="true"
            />
            <span className="font-display hidden text-base font-bold tracking-tight text-landing-cream sm:inline sm:text-xl">
              <span className="text-landing-green">Team</span>
              <span className="text-landing-cream">Network</span>
            </span>
            <span className="sr-only">TeamNetwork</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <Link href="/#features" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Features</Link>
            <Link href="/#pricing" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Pricing</Link>
            <Link href="/demos" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Demo</Link>
            <Link href="/#faq" className="text-landing-cream/70 hover:text-landing-cream transition-colors">FAQ</Link>
            <Link href="/terms" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Terms</Link>
          </nav>
          <div className="flex items-center gap-3">
            <ButtonLink href="/auth/login" variant="custom" className="text-landing-cream/80 hover:text-landing-cream hover:bg-landing-cream/10">
              Sign In
            </ButtonLink>
            <ButtonLink href="/auth/signup" variant="custom" className="bg-landing-green-dark hover:bg-[#059669] text-white font-semibold px-5">
              Get Started
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="relative z-10 pt-16 lg:pt-24 pb-12 px-6">
          <div className="max-w-6xl mx-auto text-center">
            <div className="hero-animate inline-flex items-center gap-2 px-4 py-2 rounded-full bg-landing-cream/10 border border-landing-cream/20 mb-6">
              <span className="w-2 h-2 rounded-full bg-landing-cream/60 gold-shimmer" />
              <span className="text-landing-cream/80 text-sm font-medium">Demo</span>
            </div>
            <h1 className="hero-animate font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-5">
              See TeamNetwork in Action
            </h1>
            <p className="hero-animate text-lg text-landing-cream/60 mb-12 leading-relaxed max-w-2xl mx-auto">
              Manage rosters, events, fundraising, and communication — all in one place built for teams.
            </p>
          </div>
        </section>

        {/* Screenshot */}
        <section className="relative z-10 px-6 pb-16">
          <div className="max-w-5xl mx-auto">
            <div className="scroll-reveal rounded-2xl border border-landing-cream/15 shadow-2xl shadow-black/40 overflow-hidden bg-landing-navy-light/40">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 bg-landing-navy-light/60 border-b border-landing-cream/10">
                <span className="w-3 h-3 rounded-full bg-red-500/70" />
                <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <span className="w-3 h-3 rounded-full bg-green-500/70" />
                <span className="ml-3 text-xs text-landing-cream/30 font-mono">myteamnetwork.com</span>
              </div>
              <Image
                src="/app-screenshot.png"
                alt="TeamNetwork dashboard showing roster management, events, and team communication"
                width={1920}
                height={1080}
                className="w-full h-auto"
                priority
              />
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative z-10 px-6 pb-24">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="scroll-reveal font-display text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Request a Demo
            </h2>
            <p className="scroll-reveal text-landing-cream/60 text-lg leading-relaxed mb-8">
              Want a personalized walkthrough? Reach out and we&apos;ll show you how TeamNetwork can work for your organization.
            </p>
            <div className="scroll-reveal flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="mailto:cicconel@myteamnetwork.com?subject=Demo%20Request"
                className="inline-flex items-center gap-2 bg-landing-green-dark hover:bg-[#059669] text-white font-semibold px-8 py-4 rounded-lg text-base transition-colors green-glow"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
                Request a Demo
              </a>
              <ButtonLink href="/auth/signup" variant="custom" size="lg" className="bg-landing-cream/10 text-landing-cream hover:bg-landing-cream/20 border border-landing-cream/20 px-8 py-4 text-base">
                Get Started Free
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-landing-cream/10 py-12 bg-landing-navy">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-landing-green-dark flex items-center justify-center">
                <span className="font-display font-bold text-white text-sm">TN</span>
              </div>
              <span className="font-display font-bold">TeamNetwork</span>
            </div>

            <div className="flex items-center gap-8 text-sm text-landing-cream/50">
              <Link href="/terms" className="hover:text-landing-cream transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-landing-cream transition-colors">Privacy</Link>
              <Link href="/#pricing" className="hover:text-landing-cream transition-colors">Pricing</Link>
              <a href="mailto:support@myteamnetwork.com" className="hover:text-landing-cream transition-colors">Contact</a>
            </div>

            <p className="text-sm text-landing-cream/30">
              &copy; {new Date().getFullYear()} TeamNetwork
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
