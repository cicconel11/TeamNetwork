import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui";
import { LandingAnimations, FloatingParticles } from "@/components/marketing";
import { FEATURES, FAQ_ITEMS } from "@/lib/pricing";
import { PricingSection } from "@/components/marketing/PricingSection";

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
      <header className="relative z-20 sticky top-0 bg-landing-navy/95 backdrop-blur-md border-b border-landing-cream/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="#top" className="group flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-landing-green-dark flex items-center justify-center">
              <span className="font-display font-bold text-white text-sm">TN</span>
            </div>
            <span className="font-display text-xl font-bold tracking-tight">
              Team<span className="text-landing-cream">Network</span>
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <Link href="#features" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Features</Link>
            <Link href="#pricing" className="text-landing-cream/70 hover:text-landing-cream transition-colors">Pricing</Link>
            <Link href="#faq" className="text-landing-cream/70 hover:text-landing-cream transition-colors">FAQ</Link>
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

      {/* Hero */}
      <section className="relative z-10 pt-20 lg:pt-32 pb-20 px-6">
        {/* Animated Orbs */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none -z-10">
          <div className="gradient-orb w-[500px] h-[500px] bg-landing-green/20 top-[-100px] left-[-100px]" style={{ animationDelay: '0s' }} />
          <div className="gradient-orb w-[300px] h-[300px] bg-landing-green-dark/15 top-[40%] right-[-50px]" style={{ animationDelay: '-5s' }} />
          <div className="gradient-orb w-[400px] h-[400px] bg-landing-cream/8 bottom-[-100px] left-[20%]" style={{ animationDelay: '-10s' }} />
        </div>
        
        <FloatingParticles />

        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left - Copy */}
            <div>
              <div className="hero-animate inline-flex items-center gap-2 px-4 py-2 rounded-full bg-landing-cream/10 border border-landing-cream/20 mb-8">
                <span className="w-2 h-2 rounded-full bg-landing-cream/60 gold-shimmer" />
                <span className="text-landing-cream/80 text-sm font-medium">Built for teams that go the distance</span>
              </div>

              <h1 className="hero-animate font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
                Your Team&apos;s
                <br />
                <span className="text-landing-cream">Hub for Everything</span>
              </h1>

              <p className="hero-animate text-xl text-landing-cream/70 max-w-lg mb-10 leading-relaxed">
                Member directories, events, donations, philanthropy, and records — all in one place. Built for sports teams, students, clubs, and organizations of all kinds.
              </p>

              <div className="hero-animate flex flex-col sm:flex-row gap-4">
                <ButtonLink href="/auth/signup" variant="custom" size="lg" className="bg-landing-green-dark hover:bg-[#059669] text-white font-semibold px-8 py-6 text-base green-glow">
                  Create Your Organization
                </ButtonLink>
                <ButtonLink href="/auth/login?redirect=/app/join" size="lg" variant="custom" className="bg-landing-cream/10 text-landing-cream hover:bg-landing-cream/20 border border-landing-cream/20 px-8 py-6 text-base">
                  Sign In
                </ButtonLink>
              </div>

              {/* Trust badges */}
              <div className="hero-animate mt-10">
                <p className="text-landing-cream/50 text-sm">Have an invite code?</p>
                <Link href="/auth/login?redirect=/app/join" className="inline-flex items-center gap-2 text-landing-cream/70 hover:text-landing-cream transition-colors mt-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span className="font-medium">Join an Organization</span>
                </Link>
              </div>
            </div>

            {/* Right - Example Organization */}
            <div className="hero-animate relative">
              {/* Mock organization card */}
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
                {/* Quick stats */}
                <div className="grid grid-cols-3 divide-x divide-landing-cream/10 border-b border-landing-cream/10">
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold text-landing-cream">127</p>
                    <p className="text-xs text-landing-cream/50">Members</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold text-landing-cream">24</p>
                    <p className="text-xs text-landing-cream/50">Events</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-2xl font-bold text-landing-cream">$8.2k</p>
                    <p className="text-xs text-landing-cream/50">Donations</p>
                  </div>
                </div>
                {/* Feature preview */}
                <div className="p-5 space-y-3">
                  {[
                    { icon: "users", label: "Member Directory", value: "48 active • 79 alumni" },
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

      {/* Organization types ribbon */}
      <section className="relative z-10 py-12 overflow-hidden border-y border-landing-cream/10 bg-landing-navy-light/50">
        <div className="flex items-center justify-center gap-12 text-landing-cream/40 text-sm uppercase tracking-[0.2em]">
          {["Sports Teams", "Greek Life", "Clubs", "Volunteer Orgs", "Alumni Groups"].map((type, i) => (
            <div key={type} className="flex items-center gap-12">
              <span className="whitespace-nowrap">{type}</span>
              {i < 4 && <span className="text-landing-cream/20">◆</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="scroll-reveal inline-block px-4 py-1.5 rounded-full bg-landing-cream/5 text-landing-cream/60 text-xs uppercase tracking-[0.2em] mb-6">
              Features
            </div>
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold mb-6">
              Everything Your
              <br />
              <span className="text-landing-cream">Team Needs</span>
            </h2>
            <p className="scroll-reveal text-landing-cream/60 max-w-xl mx-auto text-lg">
              From daily operations to alumni engagement, we&apos;ve got you covered.
            </p>
          </div>

          <div className="features-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature, i) => (
              <div
                key={feature.title}
                className="feature-card bg-landing-navy-light/50 backdrop-blur-sm rounded-2xl p-6"
              >
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

      {/* How It Works */}
      <section className="relative z-10 py-24 px-6 bg-landing-navy-light/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold">
              Get Started in <span className="text-landing-cream">3 Steps</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Connection line */}
            <div className="hidden md:block absolute top-12 left-1/4 right-1/4 h-px bg-gradient-to-r from-landing-cream/20 via-landing-cream/30 to-landing-cream/20" />

            {[
              { step: "01", title: "Create your org", desc: "Sign up and customize your team's profile, colors, and settings." },
              { step: "02", title: "Invite members", desc: "Share your unique invite code or send email invitations." },
              { step: "03", title: "Build your legacy", desc: "Track events, manage donations, and connect generations." },
            ].map((item) => (
              <div key={item.step} className="scroll-reveal text-center relative">
                <div className="w-24 h-24 rounded-full bg-landing-navy border-2 border-landing-cream/20 flex items-center justify-center mx-auto mb-6 relative z-10">
                  <span className="athletic-number text-3xl">{item.step}</span>
                </div>
                <h3 className="font-display font-semibold text-xl text-landing-cream mb-3">{item.title}</h3>
                <p className="text-landing-cream/50 text-sm leading-relaxed max-w-xs mx-auto">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* FAQ */}
      <section id="faq" className="relative z-10 py-24 px-6 bg-landing-navy-light/30">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="scroll-reveal font-display text-4xl sm:text-5xl font-bold">
              Questions? <span className="text-landing-cream">Answers.</span>
            </h2>
          </div>

          <div className="space-y-4">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.question}
                className="scroll-reveal group bg-landing-navy-light/50 rounded-xl border border-landing-cream/10 overflow-hidden"
              >
                <summary className="px-6 py-5 cursor-pointer list-none flex items-center justify-between text-landing-cream font-medium hover:bg-landing-cream/5 transition-colors">
                  {item.question}
                  <svg
                    className="w-5 h-5 text-landing-cream/60 group-open:rotate-180 transition-transform duration-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-6 pb-5 text-landing-cream/60 leading-relaxed">{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Terms Summary */}
      <section id="terms-summary" className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="scroll-reveal font-display text-3xl sm:text-4xl font-bold mb-4">Terms of Service</h2>
            <p className="scroll-reveal text-landing-cream/60">
              By using TeamNetwork you agree to our terms. Here are the key points:
            </p>
          </div>

          <div className="terms-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {[
              { title: "Eligibility", text: "Must be 16+ to use the service." },
              { title: "Security", text: "You're responsible for your credentials." },
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

      {/* Final CTA */}
      <section className="relative z-10 py-24 px-6 overflow-hidden">
        {/* Animated Orbs */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none -z-10">
          <div className="gradient-orb w-[600px] h-[600px] bg-landing-green/10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ animationDelay: '-15s' }} />
        </div>

        <div className="max-w-4xl mx-auto text-center">
          <div className="scroll-reveal inline-block banner-ribbon text-white text-sm font-semibold uppercase tracking-wider mb-8">
            Ready to Start?
          </div>

          <h2 className="scroll-reveal font-display text-4xl sm:text-5xl lg:text-6xl font-bold mb-6">
            Build Your Team&apos;s
            <br />
            <span className="text-landing-green">Legacy Today</span>
          </h2>

          <p className="scroll-reveal text-xl text-landing-cream/60 mb-10 max-w-2xl mx-auto">
            Join today to create new opportunities for your organization and members.
          </p>

          <div className="scroll-reveal flex flex-col sm:flex-row gap-4 justify-center">
            <ButtonLink href="/auth/signup" variant="custom" size="lg" className="bg-landing-green-dark hover:bg-[#059669] text-white font-semibold px-10 py-6 text-lg green-glow">
              Create Your Organization
            </ButtonLink>
            <ButtonLink href="/auth/login" size="lg" variant="custom" className="bg-landing-cream/10 text-landing-cream hover:bg-landing-cream/20 border border-landing-cream/20 px-10 py-6 text-lg">
              Sign In
            </ButtonLink>
          </div>
        </div>
      </section>

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
              <Link href="#pricing" className="hover:text-landing-cream transition-colors">Pricing</Link>
              <a href="mailto:support@myteamnetwork.com" className="hover:text-landing-cream transition-colors">Contact</a>
            </div>

            <p className="text-sm text-landing-cream/30">
              © {new Date().getFullYear()} TeamNetwork
            </p>
          </div>
        </div>
      </footer>

      {/* Back to top */}
      <Link
        href="#top"
        aria-label="Back to top"
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full border border-landing-cream/20 bg-landing-navy/80 px-4 py-3 text-sm font-semibold text-landing-cream/80 shadow-lg backdrop-blur transition hover:-translate-y-1 hover:bg-landing-cream/10 hover:text-landing-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-green/60 focus-visible:ring-offset-2 focus-visible:ring-offset-landing-navy"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
        Top
      </Link>
    </div>
  );
}

function FeatureIcon({ index }: { index: number }) {
  const icons = [
    <path key="0" strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />,
    <path key="1" strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />,
    <path key="2" strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    <path key="3" strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />,
    <path key="4" strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />,
    <path key="5" strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />,
  ];
  return (
    <svg className="w-6 h-6 text-landing-cream/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      {icons[index]}
    </svg>
  );
}

function FeatureCardIcon({ type }: { type: string }) {
  const iconPaths: { [key: string]: JSX.Element } = {
    users: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />,
    calendar: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />,
    dollar: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    trophy: <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />,
  };
  return (
    <svg className="w-5 h-5 text-landing-cream/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      {iconPaths[type] || iconPaths.users}
    </svg>
  );
}

function TermsIcon({ index }: { index: number }) {
  const icons = [
    <path key="0" strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />,
    <path key="1" strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />,
    <path key="2" strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.97z" />,
    <path key="3" strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />,
    <path key="4" strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />,
    <path key="5" strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0116.35 15m.002 0h-.002" />,
  ];
  return (
    <svg className="w-5 h-5 text-landing-cream/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      {icons[index]}
    </svg>
  );
}
