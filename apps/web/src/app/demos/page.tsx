import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { LandingAnimations } from "@/components/marketing";

type Demo = {
  title: string;
  description?: string;
  embedUrl: string;
};

const DEMOS: Demo[] = [
  {
    title: "Demo",
    description: "See how teams organize rosters, alumni, and contact details in one place.",
    embedUrl: "https://app.supademo.com/demo/cmklf78hp009o480iht07r3iv?utm_source=link",
  },
];

export const metadata: Metadata = {
  title: "Demos | TeamNetwork",
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
            <div className="w-8 h-8 rounded bg-landing-green-dark flex items-center justify-center">
              <span className="font-display font-bold text-white text-sm">TN</span>
            </div>
            <span className="font-display text-xl font-bold tracking-tight">
              Team<span className="text-landing-cream">Network</span>
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <Link href="/#features" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Features</Link>
            <Link href="/#pricing" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Pricing</Link>
            <Link href="/demos" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Demos</Link>
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
          <div className="max-w-6xl mx-auto">
            <div className="max-w-3xl">
              <div className="hero-animate inline-flex items-center gap-2 px-4 py-2 rounded-full bg-landing-cream/10 border border-landing-cream/20 mb-6">
                <span className="w-2 h-2 rounded-full bg-landing-cream/60 gold-shimmer" />
                <span className="text-landing-cream/80 text-sm font-medium">Demos</span>
              </div>
              <h1 className="hero-animate font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-5">
                See TeamNetwork in action
              </h1>
              <p className="hero-animate text-lg text-landing-cream/60 mb-8 leading-relaxed">
                Explore short, shareable walkthroughs that highlight how teams manage members, events, and fundraising.
              </p>
              <div className="hero-animate flex flex-col sm:flex-row gap-4">
                <ButtonLink href="/auth/signup" variant="custom" size="lg" className="bg-landing-green-dark hover:bg-[#059669] text-white font-semibold px-8 py-5 text-base green-glow">
                  Get Started
                </ButtonLink>
                <ButtonLink href="/#pricing" variant="custom" size="lg" className="bg-landing-cream/10 text-landing-cream hover:bg-landing-cream/20 border border-landing-cream/20 px-8 py-5 text-base">
                  View Pricing
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>

        {/* Demo cards */}
        <section className="relative z-10 px-6 pb-16">
          <div className="max-w-6xl mx-auto">
            <div className="scroll-reveal grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {DEMOS.map((demo, index) => (
                <a
                  key={demo.title}
                  href={`#demo-${index}`}
                  className="group bg-landing-navy-light/50 backdrop-blur-sm rounded-2xl p-6 border border-landing-cream/10 transition hover:border-landing-green/40 hover:bg-landing-navy-light/70"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-display text-xl font-semibold text-landing-cream mb-2">{demo.title}</h3>
                      {demo.description && (
                        <p className="text-sm text-landing-cream/60 leading-relaxed">{demo.description}</p>
                      )}
                    </div>
                    <span className="mt-1 inline-flex items-center justify-center w-9 h-9 rounded-full border border-landing-cream/20 text-landing-cream/60 group-hover:text-landing-cream group-hover:border-landing-green/40 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                      </svg>
                    </span>
                  </div>
                  <span className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-landing-cream/50 group-hover:text-landing-cream transition-colors">
                    Jump to demo
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Demo embeds */}
        <section className="relative z-10 px-6 pb-24">
          <div className="max-w-6xl mx-auto space-y-12">
            {DEMOS.map((demo, index) => (
              <div key={demo.title} id={`demo-${index}`} className="scroll-reveal scroll-mt-28 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-landing-cream/50 mb-2">
                    Demo {index + 1}
                  </p>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold text-landing-cream">
                    {demo.title}
                  </h2>
                  {demo.description && (
                    <p className="text-landing-cream/60 mt-2 max-w-3xl">{demo.description}</p>
                  )}
                </div>
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-landing-cream/10 bg-landing-navy-light/60">
                  <div className="absolute inset-0 animate-pulse bg-landing-navy-light/70" aria-hidden="true" />
                  <iframe
                    src={demo.embedUrl}
                    title={`${demo.title} demo`}
                    className="absolute inset-0 w-full h-full"
                    allow="clipboard-write; fullscreen"
                    loading="lazy"
                  />
                </div>
              </div>
            ))}
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
